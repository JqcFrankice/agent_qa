import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as schema from "../../src/db/schema.js";

export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const migration = readFileSync(resolve("src/db/migrations/0000_initial.sql"), "utf8");
  sqlite.exec(migration);
  return drizzle(sqlite, { schema });
}
