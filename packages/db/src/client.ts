import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * A database handle. Production uses Neon over HTTP (no connection to keep
 * alive between serverless invocations); tests use an in-process Postgres.
 * Every repo write is a single statement, so nothing here needs an
 * interactive transaction and both drivers behave the same.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Connects to Neon. Defaults to `DATABASE_URL`. */
export function createDb(url: string | undefined = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle({ client: neon(url), schema });
}
