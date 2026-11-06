import "server-only";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "@/server/env";
import { log } from "@/server/log";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const MIGRATION = resolve(process.cwd(), "db", "migrations", "0001_init.sql");

declare global {
  // Survives Next.js dev hot reloads.
  var __saathiDb: Promise<Db> | undefined;
}

async function connect(): Promise<Db> {
  const sql = readFileSync(MIGRATION, "utf8");
  if (env.databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: env.databaseUrl, max: 5 });
    await pool.query(sql);
    log.info("db.ready", { provider: "postgres" });
    return drizzle(pool, { schema });
  }
  // No DATABASE_URL: run real PostgreSQL in-process via PGlite (WASM), persisted under .data/.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = join(env.dataDir, "pglite");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.exec(sql);
  log.info("db.ready", { provider: "pglite" });
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

export function databaseProvider(): "postgres" | "pglite" {
  return env.databaseUrl ? "postgres" : "pglite";
}
