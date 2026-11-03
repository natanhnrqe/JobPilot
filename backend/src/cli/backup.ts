import { loadConfig } from "../config/index.js";
import { DbHolder } from "../db/holder.js";
import { createLogger } from "../logging/logger.js";
import { createBackup } from "../backup/backup.js";

const config = loadConfig();
const logger = createLogger({ logDir: config.logsDir });
const holder = new DbHolder(config, logger);

try {
  const backup = createBackup({ config, holder }, "manual");
  console.log(
    `Backup criado: ${config.backupsDir}\\${backup.fileName} (${backup.sizeBytes} bytes)`,
  );
  holder.close();
} catch (err) {
  logger.error("Falha no backup", { erro: String(err) });
  console.error(String(err));
  process.exitCode = 1;
}
