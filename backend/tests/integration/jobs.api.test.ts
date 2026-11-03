import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestServer, type AppServer } from "../helpers.js";

let server: AppServer;
let cleanup: () => void;

beforeAll(() => {
  const created = makeTestServer();
  server = created.server;
  cleanup = created.cleanup;
});

afterAll(() => cleanup());

describe("API de vagas (Marco 1)", () => {
  let jobId = 0;

  it("cria vaga com apenas o título (campos opcionais permanecem nulos)", async () => {
    const res = await request(server.app).post("/api/v1/jobs").send({ title: "Dev Júnior" });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Dev Júnior");
    expect(res.body.status).toBe("new");
    expect(res.body.company).toBeNull();
    expect(res.body.workMode).toBe("unknown");
    expect(res.body.contractType).toBe("unknown");
    jobId = res.body.id;
  });

  it("registra evento job.created na criação", async () => {
    const res = await request(server.app).get(`/api/v1/jobs/${jobId}`);
    expect(res.status).toBe(200);
    const created = res.body.events.find((e: { type: string }) => e.type === "job.created");
    expect(created).toBeTruthy();
    expect(created.actor).toBe("user");
    expect(created.to).toBe("new");
  });

  it("rejeita criação sem título (400 com envelope)", async () => {
    const res = await request(server.app).post("/api/v1/jobs").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejeita sourceUrl sem http(s) (400)", async () => {
    const res = await request(server.app)
      .post("/api/v1/jobs")
      .send({ title: "X", sourceUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);
  });

  it("edita campos sem mudar de status", async () => {
    const res = await request(server.app).patch(`/api/v1/jobs/${jobId}`).send({
      company: "Acme",
      workMode: "remote",
      contractType: "junior",
      sourceUrl: "https://exemplo.com/vaga",
    });
    expect(res.status).toBe(200);
    expect(res.body.company).toBe("Acme");
    expect(res.body.workMode).toBe("remote");
    expect(res.body.status).toBe("new");
  });

  it("aplica transição de status válida e registra evento com from/to", async () => {
    const res = await request(server.app)
      .patch(`/api/v1/jobs/${jobId}`)
      .send({ status: "prioritized" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("prioritized");

    const detail = await request(server.app).get(`/api/v1/jobs/${jobId}`);
    const event = detail.body.events.find((e: { type: string }) => e.type === "job.status_changed");
    expect(event.from).toBe("new");
    expect(event.to).toBe("prioritized");
  });

  it("rejeita transição inválida com 409 e lista as permitidas", async () => {
    // closed só aceita voltar para new; prioritized → closed é válido, então usamos closed → prioritized
    await request(server.app).patch(`/api/v1/jobs/${jobId}`).send({ status: "closed" });
    const res = await request(server.app)
      .patch(`/api/v1/jobs/${jobId}`)
      .send({ status: "prioritized" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
    expect(res.body.error.details.allowedTransitions).toEqual(["new"]);
  });

  it("status arbitrário/inválido é recusado (400)", async () => {
    const res = await request(server.app)
      .patch(`/api/v1/jobs/${jobId}`)
      .send({ status: "contratado" });
    expect(res.status).toBe(400);
  });

  it("vaga inexistente retorna 404", async () => {
    const res = await request(server.app).get("/api/v1/jobs/99999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("exclui (soft delete), sai da listagem padrão e restaura", async () => {
    const create = await request(server.app)
      .post("/api/v1/jobs")
      .send({ title: "Estágio Front-end", company: "Beta" });
    const id = create.body.id as number;

    const del = await request(server.app).delete(`/api/v1/jobs/${id}`);
    expect(del.status).toBe(200);

    const listDefault = await request(server.app).get("/api/v1/jobs");
    expect(listDefault.body.items.some((j: { id: number }) => j.id === id)).toBe(false);

    // incluída com includeDeleted=true
    const listAll = await request(server.app).get("/api/v1/jobs?includeDeleted=true");
    const found = listAll.body.items.find((j: { id: number }) => j.id === id);
    expect(found).toBeTruthy();
    expect(found.deletedAt).toBeTruthy();

    // evento job.deleted
    const detail = await request(server.app).get(`/api/v1/jobs/${id}?includeDeleted=true`);
    expect(detail.body.events.some((e: { type: string }) => e.type === "job.deleted")).toBe(true);

    // PATCH em vaga excluída → 404 (não permite editar excluída)
    const patch = await request(server.app).patch(`/api/v1/jobs/${id}`).send({ title: "Novo" });
    expect(patch.status).toBe(404);

    const restore = await request(server.app).post(`/api/v1/jobs/${id}/restore`);
    expect(restore.status).toBe(200);
    expect(restore.body.deletedAt).toBeNull();

    const listAgain = await request(server.app).get("/api/v1/jobs");
    expect(listAgain.body.items.some((j: { id: number }) => j.id === id)).toBe(true);
  });

  it("exclusão de vaga com candidatura exclui a candidatura junto e restaura as duas", async () => {
    const create = await request(server.app).post("/api/v1/jobs").send({ title: "Dev React Jr" });
    const id = create.body.id as number;

    const app = await request(server.app).post(`/api/v1/jobs/${id}/application`);
    expect(app.status).toBe(201);
    const appId = app.body.id as number;
    expect(app.body.status).toBe("preparing");

    await request(server.app).delete(`/api/v1/jobs/${id}`);

    // candidatura ficou excluída junto (não aparece na listagem)
    const apps = await request(server.app).get("/api/v1/applications");
    expect(apps.body.items.some((a: { id: number }) => a.id === appId)).toBe(false);

    // restaurar a vaga restaura a candidatura
    await request(server.app).post(`/api/v1/jobs/${id}/restore`);
    const appsAfter = await request(server.app).get("/api/v1/applications");
    expect(appsAfter.body.items.some((a: { id: number }) => a.id === appId)).toBe(true);
  });

  it("lista com filtros por status e busca por título/empresa", async () => {
    await request(server.app)
      .post("/api/v1/jobs")
      .send({ title: "Backend Node Jr", company: "Gama" });
    await request(server.app)
      .post("/api/v1/jobs")
      .send({ title: "Analista de Dados", company: "Gama" });

    const onlyNode = await request(server.app).get("/api/v1/jobs?q=node");
    expect(onlyNode.body.items.every((j: { title: string }) => /node/i.test(j.title))).toBe(true);

    const prioritized = await request(server.app).get("/api/v1/jobs?status=prioritized");
    expect(
      prioritized.body.items.every((j: { status: string }) => j.status === "prioritized"),
    ).toBe(true);
  });

  it("rota inexistente da API retorna 404 com envelope", async () => {
    const res = await request(server.app).get("/api/v1/inexistente");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
