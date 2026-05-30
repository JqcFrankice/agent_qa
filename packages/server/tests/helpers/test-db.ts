import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as schema from "../../src/db/schema.js";

export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const migrationsDir = resolve("src/db/migrations");
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    sqlite.exec(readFileSync(resolve(migrationsDir, file), "utf8"));
  }
  return drizzle(sqlite, { schema });
}
