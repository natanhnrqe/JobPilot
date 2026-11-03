import fs from "node:fs";
import path from "node:path";
import type { Db } from "./connection.js";

/**
 * Executa as migrações SQL versionadas de `migrationsDir`.
 * Idempotente: cada arquivo roda no máximo uma vez (tabela schema_migrations).
 */
export function runMigrations(db: Db, migrationsDir: string): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.all<{ version: number }>("SELECT version FROM schema_migrations").map((r) => r.version),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => versionOf(a) - versionOf(b));

  const executed: string[] = [];

  for (const file of files) {
    const version = versionOf(file);
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.withTransaction(() => {
      db.exec(sql);
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [
        version,
        file,
        new Date().toISOString(),
      ]);
    });
    executed.push(file);
  }

  return executed;
}

function versionOf(fileName: string): number {
  const match = /^(\d+)_/.exec(fileName);
  if (!match) throw new Error(`Arquivo de migração inválido: ${fileName}`);
  return Number(match[1]);
}
