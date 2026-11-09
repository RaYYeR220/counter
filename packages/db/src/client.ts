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

/** Data directory of a freshly migrated database, built once per process. */
let migratedImage: Promise<Blob> | undefined;

async function migrated(): Promise<Blob> {
  const [{ PGlite }, { drizzle: drizzlePglite }, { migrate }, { fileURLToPath }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("node:url"),
  ]);
  const pg = new PGlite();
  await migrate(drizzlePglite({ client: pg }), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const image = await pg.dumpDataDir("none");
  await pg.close();
  return image;
}

/**
 * A fresh in-memory Postgres with the migrations applied. Databases start
 * from a copy of one migrated image, which is much faster than running
 * initdb and the migrations for each.
 */
export async function createTestDb(): Promise<Db> {
  migratedImage ??= migrated().catch((err: unknown) => {
    migratedImage = undefined;
    throw err;
  });
  const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);
  return drizzlePglite({ client: new PGlite({ loadDataDir: await migratedImage }), schema });
}
