// Neon Postgres access. Every entity row lives in one JSONB document table so the
// existing Base44-style entity code (filter/sort/limit) keeps working unchanged.
import { neon } from '@neondatabase/serverless';

let client;
// Tests can inject an in-process Postgres (PGlite) with the same query(text, params) shape.
export function setTestClient(test) { client = test; ready = null; }

export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw Object.assign(new Error('DATABASE_URL is not configured on the server.'), { status: 503 });
    client = neon(url);
  }
  return client;
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS entities (
     id text PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
     type text NOT NULL,
     data jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_by text,
     created_date timestamptz NOT NULL DEFAULT now(),
     updated_date timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS entities_type_updated ON entities (type, updated_date DESC)`,
  `CREATE INDEX IF NOT EXISTS entities_type_created ON entities (type, created_date DESC)`,
  `CREATE INDEX IF NOT EXISTS entities_data ON entities USING gin (data jsonb_path_ops)`,
  `CREATE TABLE IF NOT EXISTS files (
     id text PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
     content_type text NOT NULL,
     bytes bytea NOT NULL,
     size integer NOT NULL,
     uploaded_by text,
     created_date timestamptz NOT NULL DEFAULT now()
   )`,
];

let ready;
// Creates the tables on first use, so a fresh Neon database needs no manual step.
export function ensureSchema() {
  if (!ready) ready = (async () => { for (const statement of SCHEMA) await sql().query(statement); })().catch(error => { ready = null; throw error; });
  return ready;
}
