import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const { Client } = pg;

interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
}

function loadEnvFile(): Record<string, string> {
    const envPath = join(process.cwd(), ".env");
    const envContent = readFileSync(envPath, "utf-8");
    const env: Record<string, string> = {};

    for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex);
        const value = trimmed.slice(eqIndex + 1);
        env[key] = value;
    }

    return env;
}

function getConfig(): DatabaseConfig {
    const env = loadEnvFile();

    return {
        host: env.POSTGRES_HOST || "localhost",
        port: parseInt(env.POSTGRES_PORT || "5432", 10),
        database: env.POSTGRES_DATABASE || "postgres",
        user: env.POSTGRES_USER || "postgres",
        password: env.POSTGRES_PASSWORD || "",
        ssl: env.POSTGRES_SSL === "true",
    };
}

async function initDatabase() {
    const config = getConfig();

    console.log("🔧 Database Initialization Script");
    console.log("=".repeat(50));
    console.log(`📍 Host: ${config.host}`);
    console.log(`📍 Port: ${config.port}`);
    console.log(`📍 Database: ${config.database}`);
    console.log(`📍 User: ${config.user}`);
    console.log(`📍 SSL: ${config.ssl}`);
    console.log("=".repeat(50));

    const client = new Client({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : false,
    });

    try {
        console.log("\n⏳ Connecting to PostgreSQL...");
        await client.connect();
        console.log("✅ Connected successfully!");

        // Read schema file
        const schemaPath = join(process.cwd(), "src", "lib", "queue", "schema.sql");
        console.log(`\n📄 Reading schema from: ${schemaPath}`);
        const schema = readFileSync(schemaPath, "utf-8");

        console.log("⏳ Applying schema...");
        await client.query(schema);
        console.log("✅ Schema applied successfully!");

        // Verify tables exist
        console.log("\n📊 Verifying tables...");
        const tablesResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);

        console.log("✅ Tables created:");
        for (const row of tablesResult.rows) {
            console.log(`   - ${row.table_name}`);
        }

        // Verify views exist
        const viewsResult = await client.query(`
            SELECT table_name
            FROM information_schema.views
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        if (viewsResult.rows.length > 0) {
            console.log("\n✅ Views created:");
            for (const row of viewsResult.rows) {
                console.log(`   - ${row.table_name}`);
            }
        }

        // Check default queue
        const queueResult = await client.query(`
            SELECT name, queue_type, description
            FROM queues
            WHERE name = 'default'
        `);

        if (queueResult.rows.length > 0) {
            console.log("\n✅ Default queue exists:");
            console.log(`   - Name: ${queueResult.rows[0].name}`);
            console.log(`   - Type: ${queueResult.rows[0].queue_type}`);
            console.log(`   - Description: ${queueResult.rows[0].description}`);
        }

        console.log("\n🎉 Database initialization completed successfully!");

    } catch (error) {
        console.error("\n❌ Error:", error instanceof Error ? error.message : error);
        process.exit(1);
    } finally {
        await client.end();
        console.log("\n👋 Connection closed.");
    }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npx tsx scripts/init_database.ts [options]

Initializes the PostgreSQL database using the schema.sql file.
Reads connection parameters from the .env file.

Options:
  -h, --help    Show this help message

Environment Variables (from .env):
  POSTGRES_HOST       Database host (default: localhost)
  POSTGRES_PORT       Database port (default: 5432)
  POSTGRES_DATABASE   Database name (default: postgres)
  POSTGRES_USER       Database user (default: postgres)
  POSTGRES_PASSWORD   Database password
  POSTGRES_SSL        Enable SSL (true/false, default: false)

Example:
  npx tsx scripts/init_database.ts
`);
    process.exit(0);
}

initDatabase().catch(console.error);
