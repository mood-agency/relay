import {
  AnomalyDetector,
  AnomalyEvent,
  AnomalyResult,
  DetectionContext,
  DetectorRegistrationOptions,
} from "./types.js";
import { createLogger } from "../../utils.js";

const logger = createLogger("anomaly-registry");

interface RegisteredDetector {
  detector: AnomalyDetector;
  enabled: boolean;
  config: Record<string, any>;
}

/**
 * Registry for managing anomaly detectors.
 * Provides a pluggable system for adding new anomaly detection logic.
 *
 * Usage:
 * ```typescript
 * const registry = new AnomalyDetectorRegistry();
 *
 * // Register built-in detectors
 * registry.register(flashMessageDetector);
 * registry.register(largePayloadDetector);
 *
 * // Or register with custom options
 * registry.register(myDetector, { enabled: false });
 *
 * // Run detection for a specific event
 * const anomalies = await registry.runDetectors('dequeue', context);
 * ```
 */
export class AnomalyDetectorRegistry {
  private detectors: Map<string, RegisteredDetector> = new Map();
  private eventIndex: Map<AnomalyEvent, string[]> = new Map();

  /**
   * Register a new anomaly detector
   */
  register(
    detector: AnomalyDetector,
    options: DetectorRegistrationOptions = {}
  ): void {
    if (this.detectors.has(detector.name)) {
      logger.warn(
        { detectorName: detector.name },
        "Detector already registered, replacing"
      );
    }

    const registered: RegisteredDetector = {
      detector,
      enabled: options.enabled ?? detector.enabledByDefault,
      config: options.config ?? {},
    };

    this.detectors.set(detector.name, registered);

    // Update event index
    for (const event of detector.events) {
      const names = this.eventIndex.get(event) || [];
      if (!names.includes(detector.name)) {
        names.push(detector.name);
      }
      this.eventIndex.set(event, names);
    }

    logger.debug(
      {
        detectorName: detector.name,
        events: detector.events,
        enabled: registered.enabled,
      },
      "Registered anomaly detector"
    );
  }

  /**
   * Unregister a detector by name
   */
  unregister(name: string): boolean {
    const registered = this.detectors.get(name);
    if (!registered) {
      return false;
    }

    // Remove from event index
    for (const event of registered.detector.events) {
      const names = this.eventIndex.get(event) || [];
      const idx = names.indexOf(name);
      if (idx !== -1) {
        names.splice(idx, 1);
      }
      this.eventIndex.set(event, names);
    }

    this.detectors.delete(name);
    logger.debug({ detectorName: name }, "Unregistered anomaly detector");
    return true;
  }

  /**
   * Enable or disable a specific detector
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const registered = this.detectors.get(name);
    if (!registered) {
      return false;
    }
    registered.enabled = enabled;
    return true;
  }

  /**
   * Check if a detector is enabled
   */
  isEnabled(name: string): boolean {
    const registered = this.detectors.get(name);
    return registered?.enabled ?? false;
  }

  /**
   * Get all registered detectors
   */
  getDetectors(): Array<{
    name: string;
    description: string;
    events: AnomalyEvent[];
    enabled: boolean;
  }> {
    return Array.from(this.detectors.values()).map((r) => ({
      name: r.detector.name,
      description: r.detector.description,
      events: r.detector.events,
      enabled: r.enabled,
    }));
  }

  /**
   * Get detectors registered for a specific event
   */
  getDetectorsForEvent(event: AnomalyEvent): string[] {
    return this.eventIndex.get(event) || [];
  }

  /**
   * Run all enabled detectors for a specific event
   * @returns Array of detected anomalies
   */
  async runDetectors(
    event: AnomalyEvent,
    context: DetectionContext
  ): Promise<AnomalyResult[]> {
    const detectorNames = this.eventIndex.get(event) || [];
    const results: AnomalyResult[] = [];

    for (const name of detectorNames) {
      const registered = this.detectors.get(name);
      if (!registered || !registered.enabled) {
        continue;
      }

      try {
        // Merge registry config into context
        const enrichedContext: DetectionContext = {
          ...context,
          extra: { ...context.extra, ...registered.config },
        };

        const result = await registered.detector.detect(enrichedContext);
        if (result) {
          results.push(result);
          logger.debug(
            { detector: name, anomalyType: result.type },
            "Anomaly detected"
          );
        }
      } catch (err) {
        logger.error({ err, detector: name }, "Error running anomaly detector");
      }
    }

    return results;
  }

  /**
   * Run a specific detector by name (regardless of event type)
   */
  async runDetector(
    name: string,
    context: DetectionContext
  ): Promise<AnomalyResult | null> {
    const registered = this.detectors.get(name);
    if (!registered || !registered.enabled) {
      return null;
    }

    try {
      const enrichedContext: DetectionContext = {
        ...context,
        extra: { ...context.extra, ...registered.config },
      };
      return await registered.detector.detect(enrichedContext);
    } catch (err) {
      logger.error({ err, detector: name }, "Error running anomaly detector");
      return null;
    }
  }

  /**
   * Clear all registered detectors
   */
  clear(): void {
    this.detectors.clear();
    this.eventIndex.clear();
  }

  /**
   * Get statistics about the registry
   */
  getStats(): {
    totalDetectors: number;
    enabledDetectors: number;
    detectorsByEvent: Record<string, number>;
  } {
    const enabledCount = Array.from(this.detectors.values()).filter(
      (r) => r.enabled
    ).length;

    const byEvent: Record<string, number> = {};
    for (const [event, names] of this.eventIndex.entries()) {
      byEvent[event] = names.length;
    }

    return {
      totalDetectors: this.detectors.size,
      enabledDetectors: enabledCount,
      detectorsByEvent: byEvent,
    };
  }
}

// Singleton instance for global access
let globalRegistry: AnomalyDetectorRegistry | null = null;

/**
 * Get the global anomaly detector registry instance
 */
export function getGlobalRegistry(): AnomalyDetectorRegistry {
  if (!globalRegistry) {
    globalRegistry = new AnomalyDetectorRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (useful for testing)
 */
export function resetGlobalRegistry(): void {
  globalRegistry = null;
}
