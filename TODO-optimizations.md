# Optimizaciones Pendientes para Relay Queue

Este documento detalla las optimizaciones identificadas durante el análisis de rendimiento del sistema de colas.

## Estado Actual (Benchmark con DB remota ~300ms latencia)

| Operación | Ops/Sec | Latencia Avg | Queries/Op |
|-----------|---------|--------------|------------|
| Single Enqueue | 12 | 83ms | 2 |
| Batch Enqueue | 643 | 156ms | 2 |
| Single Dequeue | 4 | 225ms | 4+ |
| Full Cycle | 2 | 490ms | 7+ |

## Optimizaciones Completadas

- [x] **Bulk INSERT para batch enqueue** - 10x mejora (6 → 61 ops/sec)
- [x] **Fix bug activity_log_enabled** - 3.7x mejora (61 → 224 ops/sec)
- [x] **Separar stats de getQueueByName** - 1.6x mejora (224 → 352 ops/sec)
- [x] **Cache de queue config** - 1.8x mejora (352 → 643 ops/sec)

**Mejora total: 107x** (6 → 643 ops/sec en batch enqueue)

---

## Optimización #1: Activity Logging Asíncrono (Fire-and-Forget)

### Prioridad: Alta
### Impacto estimado: 2-3x en dequeue

### Problema actual

En cada operación de dequeue, se ejecutan múltiples queries síncronas:

```typescript
// consumer.ts líneas 116-123
await this.updateConsumerStats(consumerId || "unknown", "dequeue");
await this.checkBurstDequeue(consumerId || "unknown", queueName);
await this.logActivity("dequeue", message, { ... });
```

Cada `await` añade ~100-300ms de latencia con DB remota.

### Solución propuesta

Convertir estas operaciones en fire-and-forget (no esperar resultado):

```typescript
// Antes (síncrono)
await this.logActivity("dequeue", message, context);

// Después (asíncrono)
this.logActivity("dequeue", message, context).catch(err =>
  logger.error({ err }, "Failed to log activity")
);
```

### Archivos a modificar

1. **`src/lib/queue/services/consumer.ts`**
   - `dequeueMessage()` líneas 116-123: Hacer asíncronos `updateConsumerStats`, `checkBurstDequeue`, `logActivity`
   - `acknowledgeMessage()` líneas 229-234: Hacer asíncrono `logActivity`
   - `nackMessage()` líneas 357-361: Hacer asíncrono `logActivity`

2. **`src/lib/queue/services/producer.ts`**
   - `enqueueMessage()` líneas 68-74: Hacer asíncrono `logActivity`
   - `enqueueBatch()` línea 166: Hacer asíncrono `logActivityBatch`

### Ventajas

- Latencia reducida: dequeue pasa de ~225ms a ~80ms
- Mayor throughput: 2-3x más ops/sec
- El consumer recibe el mensaje más rápido
- La operación crítica (UPDATE del mensaje) es lo único que bloquea

### Desventajas

- **Pérdida de logs**: Si el proceso muere antes de escribir, se pierden logs
  - Mitigación: Los logs son para debugging, no críticos para el funcionamiento

- **Logs desincronizados**: El log puede aparecer después del evento real
  - Mitigación: Usar timestamp del momento del evento, no de la escritura

- **Errores silenciosos**: Si falla el INSERT del log, no lo sabrás inmediatamente
  - Mitigación: Logging local de errores con `logger.error()`

- **Memoria creciente**: Si la DB está lenta, las promesas pendientes se acumulan
  - Mitigación: Implementar un buffer con límite máximo (ver Optimización #2)

- **Orden no garantizado**: Los logs pueden llegar desordenados
  - Mitigación: Ya tienen timestamp, se ordenan al leer

### Excepciones (mantener síncrono)

- **Anomalías críticas** como `lock_stolen` - importantes para detectar problemas
- **Operaciones de admin** (delete, purge) - baja frecuencia, mejor tener confirmación

### Implementación

```typescript
// consumer.ts - dequeueMessage()

// Antes:
await this.updateConsumerStats(consumerId || "unknown", "dequeue");
await this.checkBurstDequeue(consumerId || "unknown", queueName);
await this.logActivity("dequeue", message, { ... });

// Después:
// Fire-and-forget para operaciones no críticas
this.updateConsumerStats(consumerId || "unknown", "dequeue").catch(err =>
  logger.error({ err }, "Failed to update consumer stats")
);
this.checkBurstDequeue(consumerId || "unknown", queueName).catch(err =>
  logger.error({ err }, "Failed to check burst dequeue")
);
this.logActivity("dequeue", message, { ... }).catch(err =>
  logger.error({ err }, "Failed to log dequeue activity")
);
```

---

## Optimización #2: Buffer de Activity Logs con Flush Periódico

### Prioridad: Media
### Impacto estimado: Reducir queries de logging en 90%+

### Problema actual

Cada operación individual genera un INSERT a `activity_logs`. Con alta carga, esto son miles de queries pequeñas.

### Solución propuesta

Acumular logs en memoria y hacer flush periódico en batch:

```typescript
class ActivityService {
  private logBuffer: Array<ActivityEntry> = [];
  private flushInterval: NodeJS.Timeout;
  private maxBufferSize = 100;
  private flushIntervalMs = 1000;

  constructor() {
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  async logActivity(action: string, messageData: any, context: any): Promise<void> {
    this.logBuffer.push({ action, messageData, context, timestamp: Date.now() });

    if (this.logBuffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const entries = this.logBuffer.splice(0, this.logBuffer.length);
    await this.logActivityBatch(entries);
  }
}
```

### Archivos a modificar

1. **`src/lib/queue/services/activity.ts`**
   - Añadir buffer privado
   - Modificar `logActivity()` para usar buffer
   - Añadir método `flush()` privado
   - Añadir cleanup en `disconnect()`

### Ventajas

- Reduce queries de logging de N a N/100 (con buffer de 100)
- Mejor uso de batch INSERT
- Menos presión en la conexión de DB

### Desventajas

- Pérdida de logs si el proceso muere antes del flush
- Logs aparecen con delay (hasta flushIntervalMs)
- Más complejidad en el código
- Necesita cleanup apropiado al cerrar

---

## Optimización #3: Dequeue Batch

### Prioridad: Media
### Impacto estimado: 5-10x en throughput de consumo

### Problema actual

Solo existe `dequeueMessage()` que obtiene 1 mensaje a la vez. Para procesar muchos mensajes, se hacen muchas llamadas individuales.

### Solución propuesta

Añadir método `dequeueBatch(count: number)`:

```typescript
async dequeueBatch(
  count: number,
  ackTimeout?: number,
  queueName: string = "default",
  consumerId?: string
): Promise<DequeuedMessage[]> {
  // Single UPDATE with LIMIT count
  const result = await this.ctx.pgManager.query(`
    UPDATE ${tableName} SET
      status = 'processing',
      lock_token = gen_random_uuid(),
      locked_until = NOW() + INTERVAL '${ackTimeout} seconds',
      consumer_id = $1,
      dequeued_at = NOW(),
      attempt_count = attempt_count + 1
    WHERE id IN (
      SELECT id FROM ${tableName}
      WHERE status = 'queued' AND queue_name = $2
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $3
    )
    RETURNING *
  `, [consumerId, queueName, count]);

  return result.rows.map(mapMessage);
}
```

### Archivos a modificar

1. **`src/lib/queue/services/consumer.ts`** - Añadir `dequeueBatch()`
2. **`src/lib/queue/pg-queue.ts`** - Exponer método público
3. **`src/routes/queue/queue.routes.ts`** - Añadir endpoint `/dequeue/batch`
4. **`src/routes/queue/queue.handlers.ts`** - Añadir handler

---

## Optimización #4: Prepared Statements

### Prioridad: Baja
### Impacto estimado: 10-20% reducción en latencia

### Problema actual

Cada query se parsea y planifica en PostgreSQL. Para queries frecuentes (enqueue, dequeue), esto es overhead repetido.

### Solución propuesta

Usar prepared statements de `pg`:

```typescript
// En pg-connection.ts
const PREPARED_STATEMENTS = {
  enqueue: {
    name: 'enqueue_message',
    text: `INSERT INTO messages (...) VALUES ($1, $2, ...) RETURNING *`
  },
  dequeue: {
    name: 'dequeue_message',
    text: `UPDATE messages SET ... WHERE id = (...) RETURNING *`
  }
};

// Uso
await pool.query(PREPARED_STATEMENTS.enqueue, [values]);
```

### Archivos a modificar

1. **`src/lib/queue/pg-connection.ts`** - Definir prepared statements
2. **`src/lib/queue/services/producer.ts`** - Usar prepared para enqueue
3. **`src/lib/queue/services/consumer.ts`** - Usar prepared para dequeue

---

## Optimización #5: Connection Pooling Tuning

### Prioridad: Baja
### Impacto: Variable según carga

### Configuración actual

```javascript
postgres_pool_size: 10  // default en config.js
```

### Recomendaciones

Para DB remota con alta latencia:
- Aumentar pool size a 20-50 para mayor concurrencia
- Ajustar `idleTimeoutMillis` para mantener conexiones calientes
- Considerar `connectionTimeoutMillis` apropiado

```javascript
const pgConfig = {
  max: 30,                    // más conexiones para alta latencia
  idleTimeoutMillis: 30000,   // mantener conexiones 30s idle
  connectionTimeoutMillis: 5000,
};
```

---

## Orden de implementación recomendado

1. **Optimización #1** (Activity Logging Asíncrono) - Mayor impacto, menor riesgo
2. **Optimización #3** (Dequeue Batch) - Útil para consumers de alto volumen
3. **Optimización #2** (Buffer de Logs) - Complementa #1
4. **Optimización #5** (Pool Tuning) - Ajuste de configuración
5. **Optimización #4** (Prepared Statements) - Menor impacto, más complejo

---

## Notas adicionales

### Testing después de optimizaciones

```bash
# Ejecutar benchmark completo
npx tsx benchmark.ts --test all --duration 10

# Solo dequeue para verificar mejora
npx tsx benchmark.ts --test dequeue --duration 10
```

### Monitoreo

Después de implementar logging asíncrono, monitorear:
- Uso de memoria del proceso Node.js
- Cantidad de promesas pendientes
- Logs perdidos (comparar conteo de mensajes vs logs)
