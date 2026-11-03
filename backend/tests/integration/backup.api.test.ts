import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
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

describe("Backup e restauração (Marco 1)", () => {
  let jobId = 0;

  beforeAll(async () => {
    const job = await request(server.app)
      .post("/api/v1/jobs")
      .send({ title: "Vaga Backup", company: "Empresa Backup" });
    jobId = job.body.id;
  });

  it("cria backup validado e registra em /backups", async () => {
    const res = await request(server.app).post("/api/v1/backups");
    expect(res.status).toBe(201);
    expect(res.body.fileName).toMatch(/^jobpilot-\d{8}-\d{6}-\d{3}\.sqlite$/);
    expect(res.body.sizeBytes).toBeGreaterThan(0);
    expect(res.body.kind).toBe("manual");
    expect(res.body.existsOnDisk).toBe(true);

    const listed = await request(server.app).get("/api/v1/backups");
    expect(listed.body.items.length).toBe(1);
  });

  it("arquivo de backup passa na validação de integridade e esquema", async () => {
    const listed = await request(server.app).get("/api/v1/backups");
    const fileName = listed.body.items[0].fileName as string;
    const filePath = path.join(server.ctx.config.backupsDir, fileName);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("restaura com confirm=true e os dados reais voltam", async () => {
    // cria um segundo registro APÓS o primeiro backup
    const listedBefore = await request(server.app).get("/api/v1/backups");
    const fileName = listedBefore.body.items[0].fileName as string;

    await request(server.app).post("/api/v1/jobs").send({ title: "Vaga POSTERIOR ao backup" });

    const restore = await request(server.app)
      .post("/api/v1/restore")
      .send({ fileName, confirm: true });
    expect(restore.status).toBe(200);
    expect(restore.body.restored).toBe(true);
    expect(restore.body.preRestoreBackup).toBeTruthy();

    // o banco voltou ao estado do backup: a vaga posterior não existe mais
    const jobs = await request(server.app).get("/api/v1/jobs?q=POSTERIOR");
    expect(jobs.body.total).toBe(0);

    // e a vaga original voltou
    const original = await request(server.app).get(`/api/v1/jobs/${jobId}`);
    expect(original.status).toBe(200);
    expect(original.body.title).toBe("Vaga Backup");
  });

  it("restauração sem confirmação é recusada (400)", async () => {
    const listed = await request(server.app).get("/api/v1/backups");
    const fileName = listed.body.items[0].fileName as string;

    const res = await request(server.app).post("/api/v1/restore").send({ fileName });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    // A falha é no campo de confirmação exigido.
    const issues = JSON.stringify(res.body.error.details);
    expect(issues).toContain("confirm");
  });

  it("restauração de arquivo inexistente retorna 404", async () => {
    const res = await request(server.app)
      .post("/api/v1/restore")
      .send({ fileName: "nao-existe.sqlite", confirm: true });
    expect(res.status).toBe(404);
  });

  it("restauração de arquivo inválido é cancelada (400) e banco segue intacto", async () => {
    const badFile = path.join(server.ctx.config.backupsDir, "corrompido.sqlite");
    fs.writeFileSync(badFile, "isto não é um banco sqlite");

    const res = await request(server.app)
      .post("/api/v1/restore")
      .send({ fileName: "corrompido.sqlite", confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("RESTORE_ERROR");

    // banco continua funcionando
    const health = await request(server.app).get("/api/v1/health");
    expect(health.body.ok).toBe(true);
    const jobs = await request(server.app).get("/api/v1/jobs");
    expect(jobs.status).toBe(200);

    fs.unlinkSync(badFile);
  });

  it("restauração via path traversal é recusada", async () => {
    const res = await request(server.app)
      .post("/api/v1/restore")
      .send({ fileName: "../fora/do/diretorio.sqlite", confirm: true });
    expect(res.status).toBe(400);
  });

  it("mantém no máximo 14 backups (retenção)", async () => {
    for (let i = 0; i < 16; i++) {
      const res = await request(server.app).post("/api/v1/backups");
      expect(res.status).toBe(201);
    }
    const listed = await request(server.app).get("/api/v1/backups");
    expect(listed.body.items.length).toBe(14);
    // todos os arquivos listados existem em disco
    for (const item of listed.body.items) {
      expect(item.existsOnDisk).toBe(true);
    }
  });
});
