import "server-only";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "@/server/env";
import { errorCode, log } from "@/server/log";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const MIGRATIONS_DIR = resolve(process.cwd(), "db", "migrations");
/** Arbitrary constant: serialises migrations when several serverless instances cold-start at once. */
const MIGRATION_LOCK = 727_274_001;

declare global {
  // Survives Next.js dev hot reloads.
  var __saathiDb: Promise<Db> | undefined;
}

/** All migration files, in order. Every statement is idempotent (IF NOT EXISTS). */
function migrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

/**
 * node-postgres currently treats sslmode=require as verify-full and warns that this will change;
 * pin verify-full explicitly so certificate checking stays strict after that change.
 */
function strictSsl(url: string): string {
  return url.replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/, "$1verify-full");
}

type PgPool = import("pg").Pool;
let pgPool: PgPool | null = null;

async function connect(): Promise<Db> {
  const sql = migrationSql();
  if (env.databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: strictSsl(env.databaseUrl), max: 5, idleTimeoutMillis: 10_000 });
    // Idle connections are dropped by the server/proxy (common when serverless instances suspend);
    // without a listener that surfaces as an uncaught error.
    pool.on("error", (err) => log.warn("db.pool_error", { code: errorCode(err) }));
    // Concurrent CREATE TABLE IF NOT EXISTS can race between instances; take a transaction-scoped lock.
    const client = await pool.connect();
    try {
      await client.query(`BEGIN; SELECT pg_advisory_xact_lock(${MIGRATION_LOCK}); ${sql}; COMMIT;`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    pgPool = pool;
    log.info("db.ready", { provider: "postgres" });
    return drizzle(pool, { schema });
  }
  if (env.ephemeral && process.env.ALLOW_EPHEMERAL_DB !== "1") {
    // On serverless hosts an in-process database lives in /tmp and silently loses data.
    throw new Error("DATABASE_URL is required on serverless hosts (set ALLOW_EPHEMERAL_DB=1 to override).");
  }
  // No DATABASE_URL: run real PostgreSQL in-process via PGlite (WASM), persisted under DATA_DIR.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = join(env.dataDir, "pglite");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.exec(sql);
  log.info("db.ready", { provider: env.ephemeral ? "pglite-ephemeral" : "pglite" });
  // The query-builder surface is identical; the cast only unifies the driver types.
  return drizzle(client, { schema }) as unknown as Db;
}

export function db(): Promise<Db> {
  globalThis.__saathiDb ??= connect().catch((err) => {
    globalThis.__saathiDb = undefined;
    throw err;
  });
  return globalThis.__saathiDb;
}

/**
 * Run `fn` while holding a Postgres advisory lock, so work that must not overlap (Arkiv writes from
 * one wallet) is serialised across every server instance. With the in-process PGlite database there
 * is only one process, so `fn` simply runs.
 */
export async function withAdvisoryLock<T>(lockId: number, fn: () => Promise<T>): Promise<T> {
  await db();
  if (!pgPool) return fn();
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [lockId]);
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function databaseProvider(): "postgres" | "pglite" | "pglite-ephemeral" {
  if (env.databaseUrl) return "postgres";
  return env.ephemeral ? "pglite-ephemeral" : "pglite";
}
