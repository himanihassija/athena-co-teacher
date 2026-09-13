/**
 * The Postgres connection, created lazily and only if `DATABASE_URL` is set.
 *
 * `getDb()` returns `null` when persistence isn't configured — callers (just
 * `report/persist.ts`) check for that and skip the write rather than
 * throwing, so a session still ends cleanly with no database at all.
 */

import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { config } from '../config.js';
import * as schema from './schema.js';

type Database = PostgresJsDatabase<typeof schema>;

let db: Database | null | undefined;

export function getDb(): Database | null {
  if (db !== undefined) return db;

  if (!config.databaseUrl) {
    db = null;
    return db;
  }

  const client = postgres(config.databaseUrl, { max: 5 });
  db = drizzle(client, { schema });
  return db;
}
