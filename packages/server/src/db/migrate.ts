import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";

export function migrate(dbPath: string): void {
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec("CREATE TABLE IF NOT EXISTS __drizzle_migrations (name text PRIMARY KEY NOT NULL, applied_at integer NOT NULL)");
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(here, "migrations");
  const applied = new Set(sqlite.prepare("SELECT name FROM __drizzle_migrations").all().map((row) => (row as { name: string }).name));
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    const apply = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare("INSERT INTO __drizzle_migrations (name, applied_at) VALUES (?, unixepoch())").run(file);
    });
    apply();
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const config = loadConfig();
  migrate(config.dbPath);
}
