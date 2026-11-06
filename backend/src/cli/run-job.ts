/**
 * CLI de execução de tarefas agendadas (Seção 7.1/7.2 da especificação).
 *
 * Uso:
 *   npm run collect                       # execução manual (trigger=manual)
 *   node backend/dist/cli/run-job.js --job collect --trigger scheduled
 *
 * Códigos de saída: 0 = success/partial/skipped; 1 = failed ou erro inesperado.
 * O CLI roda sem o servidor da API (acessa o SQLite diretamente).
 */

import { loadConfig } from "../config/index.js";
import { DbHolder } from "../db/holder.js";
import { createLogger } from "../logging/logger.js";
import { runCollect, type CollectTrigger } from "../services/collect.js";
import { RemotiveConnector } from "../connectors/remotive.js";
import { RemoteOkConnector } from "../connectors/remoteok.js";
import type { SourceConnector } from "../connectors/types.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const job = argValue("--job");
if (job !== "collect") {
  console.error("Uso: run-job --job collect [--trigger manual|scheduled]");
  process.exit(1);
}

const triggerArg = argValue("--trigger");
if (triggerArg !== undefined && triggerArg !== "manual" && triggerArg !== "scheduled") {
  console.error(`--trigger inválido: ${triggerArg}. Use "manual" ou "scheduled".`);
  process.exit(1);
}
const trigger: CollectTrigger = triggerArg === "scheduled" ? "scheduled" : "manual";

/** Fontes reais habilitadas — cada uma verificada e registrada em docs/FONTES.md. */
function defaultConnectors(): SourceConnector[] {
  return [new RemotiveConnector(), new RemoteOkConnector()];
}

const config = loadConfig();
const logger = createLogger({ logDir: config.logsDir });
const holder = new DbHolder(config, logger);

try {
  const result = await runCollect(
    { config, holder, ai: null },
    { connectors: defaultConnectors(), trigger },
  );

  console.log(`Coleta ${result.status} (execução #${result.runId}, ${trigger})`);
  console.log(`  ${result.summary}`);
  for (const source of result.sources) {
    const error = source.error ? ` — ${source.error}` : "";
    console.log(
      `  - ${source.name}: ${source.status} (${source.created} novas, ${source.duplicate} duplicadas, ${source.filtered} filtradas)${error}`,
    );
  }

  holder.close();
  process.exitCode = result.exitCode;
} catch (err) {
  logger.error("Falha na execução de coleta", { erro: String(err) });
  console.error(String(err));
  holder.close();
  process.exitCode = 1;
}
