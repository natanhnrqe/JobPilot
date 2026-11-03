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

describe("API de candidaturas (Marco 1)", () => {
  let jobId = 0;
  let appId = 0;

  beforeAll(async () => {
    const job = await request(server.app).post("/api/v1/jobs").send({
      title: "Dev Júnior Backend",
      company: "Sistemas Ltda",
    });
    jobId = job.body.id;
    const app = await request(server.app).post(`/api/v1/jobs/${jobId}/application`);
    appId = app.body.id;
  });

  it('cria candidatura com status inicial "preparing" e evento', async () => {
    const res = await request(server.app).get(`/api/v1/applications/${appId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("preparing");
    expect(res.body.job.title).toBe("Dev Júnior Backend");
    const created = res.body.events.find((e: { type: string }) => e.type === "application.created");
    expect(created).toBeTruthy();
    expect(created.to).toBe("preparing");
  });

  it("não permite segunda candidatura para a mesma vaga (409, relação 1:1)", async () => {
    const res = await request(server.app).post(`/api/v1/jobs/${jobId}/application`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("envio declarado pelo usuário define applied_at e evento", async () => {
    const res = await request(server.app)
      .patch(`/api/v1/applications/${appId}`)
      .send({ status: "sent" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("sent");
    expect(res.body.appliedAt).toBeTruthy();

    const detail = await request(server.app).get(`/api/v1/applications/${appId}`);
    const event = detail.body.events.find(
      (e: { type: string }) => e.type === "application.status_changed",
    );
    expect(event.from).toBe("preparing");
    expect(event.to).toBe("sent");
    expect(event.message).toContain("Envio declarado");
  });

  it("aceita data de envio informada pelo usuário (YYYY-MM-DD)", async () => {
    const res = await request(server.app)
      .patch(`/api/v1/applications/${appId}`)
      .send({ appliedAt: "2026-10-30" });
    expect(res.status).toBe(200);
    expect(res.body.appliedAt).toBe("2026-10-30T00:00:00.000Z");
  });

  it("rejeita data de envio inválida (400)", async () => {
    const res = await request(server.app)
      .patch(`/api/v1/applications/${appId}`)
      .send({ appliedAt: "não é data" });
    expect(res.status).toBe(400);
  });

  it("rejeita transição inválida (sent → preparing) com 409", async () => {
    const res = await request(server.app)
      .patch(`/api/v1/applications/${appId}`)
      .send({ status: "preparing" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
    expect(res.body.error.details.allowedTransitions).toEqual([
      "interview",
      "offer",
      "rejected",
      "withdrawn",
    ]);
  });

  it('appliedAt é recusado fora do contexto "sent" (400)', async () => {
    const job = await request(server.app).post("/api/v1/jobs").send({ title: "Vaga X" });
    const app = await request(server.app).post(`/api/v1/jobs/${job.body.id}/application`);
    const res = await request(server.app)
      .patch(`/api/v1/applications/${app.body.id}`)
      .send({ appliedAt: "2026-10-30" });
    expect(res.status).toBe(400);
  });

  it("avança sent → interview e depois interview → rejected (terminal)", async () => {
    const toInterview = await request(server.app)
      .patch(`/api/v1/applications/${appId}`)
      .send({ status: "interview" });
    expect(toInterview.status).toBe(200);

    const toRejected = await request(server.app)
      .patch(`/api/v1/applications/${appId}`)
      .send({ status: "rejected" });
    expect(toRejected.status).toBe(200);

    // rejected é terminal
    const afterRejected = await request(server.app)
      .patch(`/api/v1/applications/${appId}`)
      .send({ status: "interview" });
    expect(afterRejected.status).toBe(409);
  });

  it("mudar o status da VAGA não altera o status da candidatura (independência)", async () => {
    const job = await request(server.app).post("/api/v1/jobs").send({ title: "Vaga Independente" });
    const app = await request(server.app).post(`/api/v1/jobs/${job.body.id}/application`);

    // candidatura enviada
    await request(server.app).patch(`/api/v1/applications/${app.body.id}`).send({ status: "sent" });

    // vaga vai para discarded
    await request(server.app).patch(`/api/v1/jobs/${job.body.id}`).send({ status: "discarded" });

    const detail = await request(server.app).get(`/api/v1/applications/${app.body.id}`);
    expect(detail.body.status).toBe("sent"); // intocado
    expect(detail.body.job.status).toBe("discarded");
  });

  it("exclui candidatura (soft delete) e restaura", async () => {
    const job = await request(server.app).post("/api/v1/jobs").send({ title: "Vaga Temporária" });
    const app = await request(server.app).post(`/api/v1/jobs/${job.body.id}/application`);
    const id = app.body.id as number;

    const del = await request(server.app).delete(`/api/v1/applications/${id}`);
    expect(del.status).toBe(200);

    const list = await request(server.app).get("/api/v1/applications");
    expect(list.body.items.some((a: { id: number }) => a.id === id)).toBe(false);

    // recriar sobre candidatura excluída é recusado (restaure-a)
    const recreate = await request(server.app).post(`/api/v1/jobs/${job.body.id}/application`);
    expect(recreate.status).toBe(409);
    expect(recreate.body.error.message).toContain("restaure");

    const restore = await request(server.app).post(`/api/v1/applications/${id}/restore`);
    expect(restore.status).toBe(200);
    expect(restore.body.status).toBe("preparing");
  });

  it("lista candidaturas com jobTitle e filtro por status", async () => {
    const res = await request(server.app).get("/api/v1/applications?status=rejected");
    expect(res.status).toBe(200);
    expect(res.body.items.every((a: { status: string }) => a.status === "rejected")).toBe(true);
    expect(res.body.items[0].jobTitle).toBeTruthy();
  });
});
