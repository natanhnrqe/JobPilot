import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestServer, type AppServer } from "../helpers.js";

/**
 * Preferências de busca (migração 004) — API local, banco temporário.
 * Nenhuma rede, nenhuma chave de IA.
 */

let server: AppServer;
let cleanup: () => void;

beforeEach(() => {
  const created = makeTestServer();
  server = created.server;
  cleanup = created.cleanup;
});

afterEach(() => cleanup());

describe("API de preferências de busca", () => {
  it("GET devolve o padrão da migração 004", async () => {
    const res = await request(server.app).get("/api/v1/preferences");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      contractTypes: ["internship", "junior", "freelance"],
      includeUnknownContractType: false,
      areaKeywords: [],
    });
    expect(typeof res.body.updatedAt).toBe("string");
  });

  it("PUT atualiza e persiste os dois campos", async () => {
    const put = await request(server.app)
      .put("/api/v1/preferences")
      .send({ contractTypes: ["internship", "mid"], includeUnknownContractType: true });

    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      contractTypes: ["internship", "mid"],
      includeUnknownContractType: true,
    });

    const get = await request(server.app).get("/api/v1/preferences");
    expect(get.body).toMatchObject({
      contractTypes: ["internship", "mid"],
      includeUnknownContractType: true,
    });
  });

  it("PUT parcial mantém os campos não enviados", async () => {
    await request(server.app)
      .put("/api/v1/preferences")
      .send({ contractTypes: ["junior"] });

    const res = await request(server.app)
      .put("/api/v1/preferences")
      .send({ includeUnknownContractType: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      contractTypes: ["junior"],
      includeUnknownContractType: true,
    });
  });

  it("aceita lista vazia (sem filtro por tipo de contrato)", async () => {
    const res = await request(server.app).put("/api/v1/preferences").send({ contractTypes: [] });

    expect(res.status).toBe(200);
    expect(res.body.contractTypes).toEqual([]);
  });

  it("normaliza a ordem canônica dos tipos", async () => {
    const res = await request(server.app)
      .put("/api/v1/preferences")
      .send({ contractTypes: ["freelance", "internship"] });

    expect(res.body.contractTypes).toEqual(["internship", "freelance"]);
  });

  it("rejeita tipo inválido com 400 e envelope", async () => {
    const res = await request(server.app)
      .put("/api/v1/preferences")
      .send({ contractTypes: ["ceo"] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejeita corpo vazio com 400", async () => {
    const res = await request(server.app).put("/api/v1/preferences").send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("salva e devolve as palavras-chave de área normalizadas", async () => {
    const res = await request(server.app)
      .put("/api/v1/preferences")
      .send({ areaKeywords: ["  Desenvolvimento  ", "desenvolvimento", "Front-end", "java"] });

    expect(res.status).toBe(200);
    expect(res.body.areaKeywords).toEqual(["Desenvolvimento", "Front-end", "java"]);

    const get = await request(server.app).get("/api/v1/preferences");
    expect(get.body.areaKeywords).toEqual(["Desenvolvimento", "Front-end", "java"]);
  });

  it("aceita lista de áreas vazia (sem filtro por área)", async () => {
    const res = await request(server.app).put("/api/v1/preferences").send({ areaKeywords: [] });

    expect(res.status).toBe(200);
    expect(res.body.areaKeywords).toEqual([]);
  });

  it("PUT parcial mantém as áreas quando só o contrato muda", async () => {
    await request(server.app)
      .put("/api/v1/preferences")
      .send({ areaKeywords: ["backend"] });

    const res = await request(server.app)
      .put("/api/v1/preferences")
      .send({ contractTypes: ["internship"] });

    expect(res.body.areaKeywords).toEqual(["backend"]);
  });

  it("rejeita mais de 20 palavras-chave com 400", async () => {
    const res = await request(server.app)
      .put("/api/v1/preferences")
      .send({ areaKeywords: Array.from({ length: 21 }, (_, i) => `area-${i}`) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
