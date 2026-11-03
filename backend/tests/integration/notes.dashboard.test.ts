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

describe("Notas, dashboard e configurações (Marco 1)", () => {
  let jobId = 0;
  let appId = 0;

  beforeAll(async () => {
    const job = await request(server.app)
      .post("/api/v1/jobs")
      .send({ title: "Front-end Jr", company: "Studio XYZ" });
    jobId = job.body.id;
    const app = await request(server.app).post(`/api/v1/jobs/${jobId}/application`);
    appId = app.body.id;
  });

  it("cria nota na vaga e gera evento note.added", async () => {
    const res = await request(server.app)
      .post(`/api/v1/jobs/${jobId}/notes`)
      .send({ body: "Enviar portfólio junto" });
    expect(res.status).toBe(201);
    expect(res.body.jobId).toBe(jobId);
    expect(res.body.applicationId).toBeNull();

    const detail = await request(server.app).get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.notes.length).toBe(1);
    expect(detail.body.events.some((e: { type: string }) => e.type === "note.added")).toBe(true);
  });

  it("cria nota vinculada à candidatura (applicationId)", async () => {
    const res = await request(server.app)
      .post(`/api/v1/applications/${appId}/notes`)
      .send({ body: "Recrutadora: Ana" });
    expect(res.status).toBe(201);
    expect(res.body.applicationId).toBe(appId);
  });

  it("recusa nota para candidatura de outra vaga (400)", async () => {
    const other = await request(server.app).post("/api/v1/jobs").send({ title: "Outra vaga" });
    const otherApp = await request(server.app).post(`/api/v1/jobs/${other.body.id}/application`);

    const res = await request(server.app)
      .post(`/api/v1/jobs/${jobId}/notes`)
      .send({ body: "teste", applicationId: otherApp.body.id });
    expect(res.status).toBe(400);
  });

  it("edita e exclui nota", async () => {
    const created = await request(server.app)
      .post(`/api/v1/jobs/${jobId}/notes`)
      .send({ body: "Versão 1" });
    const id = created.body.id as number;

    const edited = await request(server.app)
      .patch(`/api/v1/notes/${id}`)
      .send({ body: "Versão 2" });
    expect(edited.status).toBe(200);
    expect(edited.body.body).toBe("Versão 2");
    expect(edited.body.updatedAt).not.toBe(edited.body.createdAt);

    const deleted = await request(server.app).delete(`/api/v1/notes/${id}`);
    expect(deleted.status).toBe(200);

    const detail = await request(server.app).get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.notes.some((n: { id: number }) => n.id === id)).toBe(false);
  });

  it("recusa nota vazia (400)", async () => {
    const res = await request(server.app).post(`/api/v1/jobs/${jobId}/notes`).send({ body: "   " });
    expect(res.status).toBe(400);
  });

  it("dashboard traz contadores reais e atividade recente", async () => {
    const res = await request(server.app).get("/api/v1/dashboard");
    expect(res.status).toBe(200);

    expect(res.body.jobs.total).toBeGreaterThan(0);
    expect(typeof res.body.jobs.byStatus.new).toBe("number");
    expect(res.body.applications.total).toBeGreaterThan(0);
    expect(res.body.applications.byStatus.preparing).toBeGreaterThan(0);

    // atividade contém a criação da vaga
    const types = res.body.activity.map((a: { type: string }) => a.type);
    expect(types).toContain("job.created");
    // feed traz o título da vaga
    const activity = res.body.activity.find((a: { type: string }) => a.type === "note.added");
    expect(activity.jobTitle).toBe("Front-end Jr");
  });

  it("feed de atividade respeita o limite", async () => {
    const res = await request(server.app).get("/api/v1/activity?limit=2");
    expect(res.body.items.length).toBeLessThanOrEqual(2);
  });

  it("settings: valores padrão, atualização e validação", async () => {
    const initial = await request(server.app).get("/api/v1/settings");
    expect(initial.status).toBe(200);
    expect(initial.body.timezone).toBe("America/Sao_Paulo");

    const put = await request(server.app)
      .put("/api/v1/settings")
      .send({ displayName: "Joy", timezone: "America/Recife" });
    expect(put.status).toBe(200);
    expect(put.body.displayName).toBe("Joy");
    expect(put.body.timezone).toBe("America/Recife");

    const bad = await request(server.app).put("/api/v1/settings").send({});
    expect(bad.status).toBe(400);
  });

  it("health reporta banco ok", async () => {
    const res = await request(server.app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe("ok");
  });
});
