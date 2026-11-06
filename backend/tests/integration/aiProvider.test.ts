import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createAiProvider } from "../../src/ai/provider.js";
import type { AiConfig } from "../../src/config/index.js";
import { AppError } from "../../src/domain/errors.js";
import { makeTestServer } from "../helpers.js";
import { VALID_EXTRACTION } from "../fakeAi.js";

/**
 * Exercita o provedor REAL (`OpenAiCompatibleProvider`) sobre HTTP: um servidor
 * local emula a API de Chat Completions da OpenAI. Nenhuma rede externa e
 * nenhuma chave real — mas o caminho de código é o de produção, não o provedor
 * falso injetado nos demais testes.
 */

interface Received {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface MockResponse {
  status: number;
  body: string;
  contentType?: string;
  delayMs?: number;
}

let server: http.Server;
let baseUrl: string;
let received: Received[] = [];
let responder: () => MockResponse;

const DEFAULT_RESPONDER = (): MockResponse => ({
  status: 200,
  body: JSON.stringify({
    choices: [{ message: { content: VALID_EXTRACTION } }],
    usage: { prompt_tokens: 120, completion_tokens: 80 },
  }),
});

beforeAll(async () => {
  responder = DEFAULT_RESPONDER;
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      received.push({
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: parsed,
      });
      const result = responder();
      setTimeout(() => {
        res.writeHead(result.status, {
          "Content-Type": result.contentType ?? "application/json",
        });
        res.end(result.body);
      }, result.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  responder = DEFAULT_RESPONDER;
});

function providerConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    apiKey: "chave-de-teste",
    baseUrl,
    model: "modelo-de-teste",
    timeoutMs: 3000,
    ...overrides,
  };
}

/** Provedor real com espera entre tentativas zerada (testes rápidos). */
function makeProvider(overrides: Partial<AiConfig> = {}) {
  return createAiProvider(providerConfig(overrides), { retryDelayMs: 0 });
}

describe("OpenAiCompatibleProvider — protocolo de Chat Completions", () => {
  it("envia a requisição no formato da OpenAI e devolve texto + tokens", async () => {
    const provider = makeProvider();
    const completion = await provider.completeJson("SISTEMA", "USUARIO");

    expect(provider.name).toBe("openai-compatible");
    expect(provider.model).toBe("modelo-de-teste");
    expect(completion.text).toBe(VALID_EXTRACTION);
    expect(completion.tokensIn).toBe(120);
    expect(completion.tokensOut).toBe(80);

    const req = received[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v1/chat/completions");
    expect(req.headers.authorization).toBe("Bearer chave-de-teste");
    expect(String(req.headers["content-type"])).toContain("application/json");
    expect(req.body.model).toBe("modelo-de-teste");
    expect(req.body.temperature).toBe(0);
    expect(req.body.response_format).toEqual({ type: "json_object" });
    expect(req.body.messages).toEqual([
      { role: "system", content: "SISTEMA" },
      { role: "user", content: "USUARIO" },
    ]);
  });

  it("não duplica a barra quando AI_BASE_URL termina em '/'", async () => {
    const provider = makeProvider({ baseUrl: `${baseUrl}/` });
    await provider.completeJson("s", "u");
    expect(received[0]!.path).toBe("/v1/chat/completions");
  });
});

describe("OpenAiCompatibleProvider — falhas do provedor", () => {
  it("401/403 → AI_UNAVAILABLE com orientação sobre AI_API_KEY", async () => {
    responder = () => ({ status: 401, body: '{"error":"invalid key"}' });
    const provider = makeProvider();
    await expect(provider.completeJson("s", "u")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      status: 503,
    });
    await expect(provider.completeJson("s", "u")).rejects.toThrow(/AI_API_KEY/);
  });

  it("429 → AI_UNAVAILABLE indicando cota", async () => {
    responder = () => ({ status: 429, body: "rate limited" });
    const provider = makeProvider();
    await expect(provider.completeJson("s", "u")).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    await expect(provider.completeJson("s", "u")).rejects.toThrow(/Cota/);
  });

  it("5xx → AI_ERROR com o status", async () => {
    responder = () => ({ status: 500, body: "boom" });
    const provider = makeProvider();
    await expect(provider.completeJson("s", "u")).rejects.toMatchObject({
      code: "AI_ERROR",
      status: 502,
    });
  });

  it("resposta sem conteúdo utilizável → AI_ERROR", async () => {
    responder = () => ({ status: 200, body: JSON.stringify({ choices: [] }) });
    const provider = makeProvider();
    await expect(provider.completeJson("s", "u")).rejects.toMatchObject({ code: "AI_ERROR" });
  });

  it("timeout → AI_UNAVAILABLE", async () => {
    responder = () => ({ status: 200, body: "{}", delayMs: 300 });
    const provider = makeProvider({ timeoutMs: 50 });
    await expect(provider.completeJson("s", "u")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      status: 503,
    });
  });

  it("conexão recusada → AI_UNAVAILABLE", async () => {
    const provider = makeProvider({ baseUrl: "http://127.0.0.1:1/v1", timeoutMs: 500 });
    await expect(provider.completeJson("s", "u")).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});

describe("OpenAiCompatibleProvider — retentativas em falhas transitórias", () => {
  it("503 transitório (duas falhas) → terceira tentativa conclui", async () => {
    let calls = 0;
    responder = () => {
      calls++;
      return calls < 3
        ? { status: 503, body: '{"error":{"code":503,"status":"UNAVAILABLE"}}' }
        : DEFAULT_RESPONDER();
    };
    const provider = makeProvider();
    const completion = await provider.completeJson("s", "u");
    expect(completion.text).toBe(VALID_EXTRACTION);
    expect(received).toHaveLength(3);
  });

  it("503 persistente → AI_UNAVAILABLE após 3 tentativas, com o motivo do provedor", async () => {
    responder = () => ({
      status: 503,
      body: JSON.stringify({
        error: {
          code: 503,
          message: "The model is overloaded. Please try again later.",
          status: "UNAVAILABLE",
        },
      }),
    });
    const provider = makeProvider();
    const error = await provider.completeJson("s", "u").then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "AI_UNAVAILABLE", status: 503 });
    expect((error as AppError).message).toMatch(/sobrecarregado|indisponível/);
    expect((error as AppError).details.trecho).toContain("overloaded");
    expect(received).toHaveLength(3);
  });

  it("429 transitório → repete e conclui", async () => {
    let calls = 0;
    responder = () => {
      calls++;
      return calls === 1 ? { status: 429, body: "rate limited" } : DEFAULT_RESPONDER();
    };
    const provider = makeProvider();
    await expect(provider.completeJson("s", "u")).resolves.toMatchObject({
      text: VALID_EXTRACTION,
    });
    expect(received).toHaveLength(2);
  });

  it("400 não é repetido (erro do pedido, não transitório)", async () => {
    responder = () => ({ status: 400, body: '{"error":"bad request"}' });
    const provider = makeProvider();
    await expect(provider.completeJson("s", "u")).rejects.toMatchObject({
      code: "AI_ERROR",
      status: 502,
    });
    expect(received).toHaveLength(1);
  });
});

describe("Fluxo completo com o provedor REAL (HTTP compatível com OpenAI)", () => {
  it("texto colado → extração real → prévia (sem persistir) → confirmação → aparece na lista", async () => {
    const created = makeTestServer({
      env: { AI_API_KEY: "chave-de-teste", AI_BASE_URL: baseUrl, AI_MODEL: "modelo-de-teste" },
    });
    try {
      const status = await request(created.server.app).get("/api/v1/extractions/status");
      expect(status.body).toEqual({
        enabled: true,
        model: "modelo-de-teste",
        provider: "openai-compatible",
      });

      const extraction = await request(created.server.app)
        .post("/api/v1/extractions/from-text")
        .send({
          text: "Estágio em Desenvolvimento Backend — Acme Tecnologia, São Paulo (híbrido).",
        });
      expect(extraction.status).toBe(200);
      expect(extraction.body.draft.title).toBe("Estágio em Desenvolvimento Backend");
      // Prova de que o provedor real foi usado (chamada HTTP de verdade).
      expect(received[0]!.path).toBe("/v1/chat/completions");

      // Nada é salvo sem confirmação.
      const before = await request(created.server.app).get("/api/v1/jobs");
      expect(before.body.items).toHaveLength(0);

      const saved = await request(created.server.app)
        .post("/api/v1/jobs")
        .send({ ...extraction.body.draft, sourceUrl: "https://acme.com/vagas/1" });
      expect(saved.status).toBe(201);

      const after = await request(created.server.app).get("/api/v1/jobs");
      expect(after.body.items.map((j: { title: string }) => j.title)).toContain(
        "Estágio em Desenvolvimento Backend",
      );
    } finally {
      created.cleanup();
    }
  });
});
