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

describe("loadConfig — RapidAPI (JSearch)", () => {
  it("sem RAPIDAPI_KEY, rapidapi é null e o restante continua válido", () => {
    const config = loadConfig({ DATA_DIR: "ignorado-nos-testes" }, { backendDir: process.cwd() });

    expect(config.rapidapi).toBeNull();
  });

  it("com RAPIDAPI_KEY, expõe chave e host padrão", () => {
    const config = loadConfig(
      { RAPIDAPI_KEY: "chave-de-teste", DATA_DIR: "ignorado-nos-testes" },
      { backendDir: process.cwd() },
    );

    expect(config.rapidapi).toEqual({ key: "chave-de-teste", host: "jsearch.p.rapidapi.com" });
  });

  it("respeita RAPIDAPI_HOST informado", () => {
    const config = loadConfig(
      {
        RAPIDAPI_KEY: "chave-de-teste",
        RAPIDAPI_HOST: "outro.p.rapidapi.com",
        DATA_DIR: "ignorado-nos-testes",
      },
      { backendDir: process.cwd() },
    );

    expect(config.rapidapi?.host).toBe("outro.p.rapidapi.com");
  });
});

describe("loadConfig — Adzuna", () => {
  it("sem credenciais, adzuna é null", () => {
    const config = loadConfig({ DATA_DIR: "ignorado-nos-testes" }, { backendDir: process.cwd() });

    expect(config.adzuna).toBeNull();
  });

  it("exige app_id e app_key juntos", () => {
    const onlyId = loadConfig(
      { ADZUNA_APP_ID: "id-de-teste", DATA_DIR: "ignorado-nos-testes" },
      { backendDir: process.cwd() },
    );
    const onlyKey = loadConfig(
      { ADZUNA_APP_KEY: "chave-de-teste", DATA_DIR: "ignorado-nos-testes" },
      { backendDir: process.cwd() },
    );

    expect(onlyId.adzuna).toBeNull();
    expect(onlyKey.adzuna).toBeNull();
  });

  it("com app_id e app_key, usa o país padrão br", () => {
    const config = loadConfig(
      {
        ADZUNA_APP_ID: "id-de-teste",
        ADZUNA_APP_KEY: "chave-de-teste",
        DATA_DIR: "ignorado-nos-testes",
      },
      { backendDir: process.cwd() },
    );

    expect(config.adzuna).toEqual({
      appId: "id-de-teste",
      appKey: "chave-de-teste",
      country: "br",
    });
  });

  it("respeita ADZUNA_COUNTRY e ignora valor em branco", () => {
    const custom = loadConfig(
      {
        ADZUNA_APP_ID: "id-de-teste",
        ADZUNA_APP_KEY: "chave-de-teste",
        ADZUNA_COUNTRY: "gb",
        DATA_DIR: "ignorado-nos-testes",
      },
      { backendDir: process.cwd() },
    );
    const blank = loadConfig(
      {
        ADZUNA_APP_ID: "id-de-teste",
        ADZUNA_APP_KEY: "chave-de-teste",
        ADZUNA_COUNTRY: "   ",
        DATA_DIR: "ignorado-nos-testes",
      },
      { backendDir: process.cwd() },
    );

    expect(custom.adzuna?.country).toBe("gb");
    expect(blank.adzuna?.country).toBe("br");
  });
});

describe("loadConfig — Jooble", () => {
  it("sem chave, jooble é null", () => {
    const config = loadConfig({ DATA_DIR: "ignorado-nos-testes" }, { backendDir: process.cwd() });

    expect(config.jooble).toBeNull();
  });

  it("com chave, usa o host padrão do Brasil", () => {
    const config = loadConfig(
      { JOOBLE_API_KEY: "chave-de-teste", DATA_DIR: "ignorado-nos-testes" },
      { backendDir: process.cwd() },
    );

    expect(config.jooble).toEqual({ apiKey: "chave-de-teste", host: "br.jooble.org" });
  });

  it("respeita JOOBLE_API_HOST e ignora chave em branco", () => {
    const custom = loadConfig(
      {
        JOOBLE_API_KEY: "chave-de-teste",
        JOOBLE_API_HOST: "uk.jooble.org",
        DATA_DIR: "ignorado-nos-testes",
      },
      { backendDir: process.cwd() },
    );
    const blank = loadConfig(
      { JOOBLE_API_KEY: "   ", DATA_DIR: "ignorado-nos-testes" },
      { backendDir: process.cwd() },
    );

    expect(custom.jooble?.host).toBe("uk.jooble.org");
    expect(blank.jooble).toBeNull();
  });
});

describe("loadConfig — LinkedIn Jobs (RapidAPI)", () => {
  it("sem LINKEDIN_API_HOST, linkedinApiHost é null", () => {
    const config = loadConfig({ DATA_DIR: "ignorado-nos-testes" }, { backendDir: process.cwd() });

    expect(config.linkedinApiHost).toBeNull();
  });

  it("expõe o host do LinkedIn quando configurado", () => {
    const config = loadConfig(
      {
        RAPIDAPI_KEY: "chave-de-teste",
        LINKEDIN_API_HOST: "linkedin-job-search-api.p.rapidapi.com",
        DATA_DIR: "ignorado-nos-testes",
      },
      { backendDir: process.cwd() },
    );

    expect(config.linkedinApiHost).toBe("linkedin-job-search-api.p.rapidapi.com");
    expect(config.rapidapi?.key).toBe("chave-de-teste");
  });

  it("ignora host em branco", () => {
    const config = loadConfig(
      { LINKEDIN_API_HOST: "   ", DATA_DIR: "ignorado-nos-testes" },
      { backendDir: process.cwd() },
    );

    expect(config.linkedinApiHost).toBeNull();
  });
});
