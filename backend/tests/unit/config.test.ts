import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";

const tmpRoots: string[] = [];
const savedEnv = { ...process.env };

afterEach(() => {
  // Restaura o ambiente e remove os diretórios temporários.
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeFakeRepo(dotEnv: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-config-"));
  tmpRoots.push(root);
  fs.mkdirSync(path.join(root, "backend"));
  fs.writeFileSync(path.join(root, ".env"), dotEnv, "utf8");
  return root;
}

describe("loadConfig — arquivo .env", () => {
  it("lê .env da raiz do repositório quando env não é informado", () => {
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
    const root = makeFakeRepo(
      [
        "# comentário deve ser ignorado",
        "AI_API_KEY=chave-de-teste",
        'AI_MODEL="modelo-teste"',
        "",
      ].join("\n"),
    );

    const config = loadConfig(undefined, { backendDir: path.join(root, "backend") });

    expect(config.ai?.apiKey).toBe("chave-de-teste");
    expect(config.ai?.model).toBe("modelo-teste");
  });

  it("process.env tem precedência sobre o arquivo .env", () => {
    process.env.AI_API_KEY = "chave-do-processo";
    const root = makeFakeRepo("AI_API_KEY=chave-do-arquivo\n");

    const config = loadConfig(undefined, { backendDir: path.join(root, "backend") });

    expect(config.ai?.apiKey).toBe("chave-do-processo");
  });

  it("funciona sem .env (sem chave, ai é null e o restante continua válido)", () => {
    delete process.env.AI_API_KEY;
    const root = makeFakeRepo("ISTO_NAO_E_UMA_CHAVE\n=linha-inválida\n");

    const config = loadConfig(undefined, { backendDir: path.join(root, "backend") });

    expect(config.ai).toBeNull();
    expect(config.port).toBeGreaterThan(0);
    expect(config.host).toBe("127.0.0.1");
  });

  it("env explícito (usado pelos testes) ignora o .env do repositório", () => {
    const root = makeFakeRepo("AI_API_KEY=chave-ignorada\nPORT=9999\n");

    const config = loadConfig(
      { ...process.env, DATA_DIR: path.join(root, "data") },
      { backendDir: path.join(root, "backend") },
    );

    expect(config.ai).toBeNull();
    expect(config.port).not.toBe(9999);
  });
});
