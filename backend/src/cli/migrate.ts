import path from "node:path";
import { loadConfig } from "../config/index.js";
import { DbHolder } from "../db/holder.js";
import { createLogger } from "../logging/logger.js";
import { runMigrations } from "../db/migrate.js";

const config = loadConfig();
const logger = createLogger({ logDir: config.logsDir });
const holder = new DbHolder(config, logger);

try {
  const db = holder.get();
  const applied = runMigrations(db, path.join(config.backendDir, "migrations"));
  if (applied.length === 0) {
    console.log("Nenhuma migração pendente. Banco em", config.databasePath);
  } else {
    console.log("Migrações aplicadas:");
    for (const file of applied) console.log(" -", file);
  }
  holder.close();
} catch (err) {
  logger.error("Falha nas migrações", { erro: String(err) });
  console.error(String(err));
  process.exitCode = 1;
}
