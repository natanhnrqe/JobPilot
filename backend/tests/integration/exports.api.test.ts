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

describe("Exportação do histórico (Fase 5.3)", () => {
  let jobId = 0;
  let appId = 0;
  let deletedJobId = 0;

  beforeAll(async () => {
    const job = await request(server.app)
      .post("/api/v1/jobs")
      .send({ title: "Dev, Pleno", company: 'Empresa "X"', location: "Recife" });
    jobId = job.body.id;
    const app = await request(server.app).post(`/api/v1/jobs/${jobId}/application`);
    appId = app.body.id;
    await request(server.app).patch(`/api/v1/applications/${appId}`).send({ status: "sent" });

    const deleted = await request(server.app).post("/api/v1/jobs").send({ title: "Vaga Excluída" });
    deletedJobId = deleted.body.id;
    await request(server.app).delete(`/api/v1/jobs/${deletedJobId}`);
  });

  it("exporta vagas em CSV com cabeçalho, aspas escapadas e BOM", async () => {
    const res = await request(server.app).get("/api/v1/exports/jobs?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("jobpilot-jobs-");

    const body = res.text;
    expect(body.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(body).toContain(
      "id,title,company,location,work_mode,contract_type,salary_text,source_url",
    );
    expect(body).toContain('"Dev, Pleno"');
    expect(body).toContain('"Empresa ""X"""');
  });

  it("exporta vagas em JSON incluindo excluídas (histórico)", async () => {
    const res = await request(server.app).get("/api/v1/exports/jobs?format=json");
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe("jobs");
    expect(res.body.count).toBeGreaterThanOrEqual(2);

    const active = res.body.items.find((j: { id: number }) => j.id === jobId);
    expect(active.title).toBe("Dev, Pleno");
    expect(active.deleted_at).toBeNull();

    const deleted = res.body.items.find((j: { id: number }) => j.id === deletedJobId);
    expect(deleted.deleted_at).toBeTruthy();
  });

  it("exporta candidaturas com dados da vaga", async () => {
    const res = await request(server.app).get("/api/v1/exports/applications?format=json");
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe("applications");
    const item = res.body.items.find((a: { id: number }) => a.id === appId);
    expect(item.job_title).toBe("Dev, Pleno");
    expect(item.company).toBe('Empresa "X"');
    expect(item.status).toBe("sent");
  });

  it("exporta eventos com título da vaga", async () => {
    const res = await request(server.app).get("/api/v1/exports/events?format=json");
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe("events");
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.items.some((e: { type: string }) => e.type === "job.created")).toBe(true);
  });

  it("recusa entidade ou formato inválidos (400)", async () => {
    const badEntity = await request(server.app).get("/api/v1/exports/curriculos?format=csv");
    expect(badEntity.status).toBe(400);
    expect(badEntity.body.error.code).toBe("VALIDATION_ERROR");

    const badFormat = await request(server.app).get("/api/v1/exports/jobs?format=xlsx");
    expect(badFormat.status).toBe(400);
  });

  it("usa CSV como formato padrão", async () => {
    const res = await request(server.app).get("/api/v1/exports/jobs");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });
});
