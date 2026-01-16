import { createInterface } from "readline";
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

async function promptConfirmation(message: string): Promise<boolean> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(message, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === "yes" || answer.toLowerCase() === "y");
        });
    });
}

async function deleteDatabase() {
    const config = getConfig();

    console.log("WARNING: Database Deletion Script");
    console.log("=".repeat(50));
    console.log(`Host: ${config.host}`);
    console.log(`Port: ${config.port}`);
    console.log(`Database: ${config.database}`);
    console.log(`User: ${config.user}`);
    console.log(`SSL: ${config.ssl}`);
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
        console.log("\nConnecting to PostgreSQL...");
        await client.connect();
        console.log("Connected successfully!");

        // List tables that will be dropped
        const tablesResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);

        const viewsResult = await client.query(`
            SELECT table_name
            FROM information_schema.views
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        if (tablesResult.rows.length === 0 && viewsResult.rows.length === 0) {
            console.log("\nNo tables or views found in the public schema.");
            console.log("Nothing to delete.");
            return;
        }

        console.log("\nThe following objects will be PERMANENTLY DELETED:");

        if (tablesResult.rows.length > 0) {
            console.log("\nTables:");
            for (const row of tablesResult.rows) {
                console.log(`   - ${row.table_name}`);
            }
        }

        if (viewsResult.rows.length > 0) {
            console.log("\nViews:");
            for (const row of viewsResult.rows) {
                console.log(`   - ${row.table_name}`);
            }
        }

        console.log("\n" + "!".repeat(50));
        console.log("THIS ACTION CANNOT BE UNDONE!");
        console.log("ALL DATA IN THESE TABLES WILL BE LOST!");
        console.log("!".repeat(50));

        const confirmed = await promptConfirmation(
            '\nType "yes" to confirm deletion: '
        );

        if (!confirmed) {
            console.log("\nDeletion cancelled.");
            return;
        }

        console.log("\nDropping all objects...");

        // Drop views first
        for (const row of viewsResult.rows) {
            console.log(`   Dropping view: ${row.table_name}`);
            await client.query(`DROP VIEW IF EXISTS "${row.table_name}" CASCADE`);
        }

        // Drop tables
        for (const row of tablesResult.rows) {
            console.log(`   Dropping table: ${row.table_name}`);
            await client.query(`DROP TABLE IF EXISTS "${row.table_name}" CASCADE`);
        }

        console.log("\nAll objects dropped successfully!");

    } catch (error) {
        console.error("\nError:", error instanceof Error ? error.message : error);
        process.exit(1);
    } finally {
        await client.end();
        console.log("\nConnection closed.");
    }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npx tsx scripts/delete_database.ts [options]

Deletes all tables and views from the PostgreSQL database.
Reads connection parameters from the .env file.

WARNING: This action is irreversible and will delete ALL data!

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
  npx tsx scripts/delete_database.ts
`);
    process.exit(0);
}

deleteDatabase().catch(console.error);
