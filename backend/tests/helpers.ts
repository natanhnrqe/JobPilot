import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { createServer, type AppServer } from "../src/http/server.js";

/**
 * Cria um servidor completo com banco SQLite em diretório temporário.
 * Cada arquivo de teste usa seu próprio diretório (isolamento total do
 * banco real do usuário — nada é gravado fora de os.tmpdir()).
 */
export function makeTestServer(): { server: AppServer; dataDir: string; cleanup(): void } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-test-"));
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = loadConfig(
    {
      ...process.env,
      DATA_DIR: dataDir,
      DATABASE_PATH: path.join(dataDir, "test.sqlite"),
    },
    { backendDir },
  );
  const server = createServer(config, createSilentLogger());

  return {
    server,
    dataDir,
    cleanup() {
      server.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function createSilentLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}
