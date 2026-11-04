import { loadConfig } from "../config/index.js";
import { DbHolder } from "../db/holder.js";
import { createLogger } from "../logging/logger.js";
import { restoreBackup } from "../backup/backup.js";

// Uso: npm run restore -- --file <nome-do-arquivo.sqlite> --yes
const args = process.argv.slice(2);
const fileIndex = args.indexOf("--file");
const fileName = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
const confirmed = args.includes("--yes");

if (!fileName || !confirmed) {
  console.error("Uso: npm run restore -- --file <nome-do-arquivo.sqlite> --yes");
  console.error(
    "A restauração cria um backup automático do estado atual antes de substituir o banco.",
  );
  process.exit(1);
}

const config = loadConfig();
const logger = createLogger({ logDir: config.logsDir });
const holder = new DbHolder(config, logger);

try {
  const result = restoreBackup({ config, holder, ai: null }, { fileName, confirm: true });
  console.log("Banco restaurado com sucesso.");
  console.log(`  Backup prévio automático: ${result.preRestoreBackup}`);
  console.log(
    `  Vagas: ${result.jobs} | Candidaturas: ${result.applications} | Notas: ${result.notes} | Eventos: ${result.events}`,
  );
  holder.close();
} catch (err) {
  logger.error("Falha na restauração", { erro: String(err) });
  console.error(String(err));
  process.exitCode = 1;
}
