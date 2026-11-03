import { loadConfig } from "./config/index.js";
import { createLogger, pruneOldLogs } from "./logging/logger.js";
import { createServer } from "./http/server.js";

function main(): void {
  const config = loadConfig();
  const logger = createLogger({ logDir: config.logsDir });
  pruneOldLogs(config.logsDir);

  const server = createServer(config, logger);

  server.app.listen(config.port, config.host, () => {
    logger.info("JobPilot iniciado", {
      endereco: `http://${config.host}:${config.port}`,
      banco: config.databasePath,
    });
  });

  const shutdown = (signal: string) => {
    logger.info("Encerrando", { sinal: signal });
    try {
      server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("uncaughtException", (err) => {
    logger.error("Erro não tratado", { erro: err.stack ?? String(err) });
    process.exitCode = 1;
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("Promessa rejeitada não tratada", { motivo: String(reason) });
  });
}

main();
