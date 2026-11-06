import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestServer, type AppServer } from "../helpers.js";
import {
  finishSearchRun,
  insertExecutionLog,
  insertSearchRun,
  upsertSource,
} from "../../src/repositories/sources.js";

/**
 * Testes OFFLINE da página/rotas de Execuções (Seção 4.5):
 * `GET /runs`, `GET /runs/:id` e `GET /sources` sobre um banco temporário.
 * `data/last-run.json` é escrito no diretório temporário de cada teste.
 */

let server: AppServer;
let dataDir: string;
let cleanup: () => void;

beforeEach(() => {
  const created = makeTestServer();
  server = created.server;
  dataDir = created.dataDir;
  cleanup = created.cleanup;
});

afterEach(() => cleanup());

function db() {
  return server.ctx.holder.get();
}

interface SeedRunOptions {
  trigger?: "manual" | "scheduled";
  startedAt?: string;
  status?: "success" | "partial" | "failed" | "skipped";
  finishedAt?: string | null;
  discovered?: number;
  created?: number;
  duplicate?: number;
  errors?: number;
  summary?: string;
}

/** Cria uma execução já finalizada (ou em andamento, com finishedAt null). */
function seedRun(opts: SeedRunOptions = {}): number {
  const id = insertSearchRun(db(), {
    trigger: opts.trigger ?? "manual",
    startedAt: opts.startedAt ?? "2026-11-05T18:00:00.000Z",
  });
  if (opts.finishedAt === null) return id;
  finishSearchRun(db(), id, {
    status: opts.status ?? "success",
    finishedAt: opts.finishedAt ?? "2026-11-05T18:00:04.500Z",
    discovered: opts.discovered ?? 10,
    created: opts.created ?? 7,
    updated: 0,
    duplicate: opts.duplicate ?? 3,
    errors: opts.errors ?? 0,
    summary: opts.summary ?? "2/2 fontes ok · 10 lidas · 7 novas · 3 duplicadas",
  });
  return id;
}

function writeLastRun(value: unknown): void {
  fs.writeFileSync(path.join(dataDir, "last-run.json"), JSON.stringify(value, null, 2), "utf8");
}

describe("GET /runs — histórico de execuções", () => {
  it("sem execuções: lista vazia e lastRun null", async () => {
    const res = await request(server.app).get("/api/v1/runs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], lastRun: null });
  });

  it("devolve as execuções mais recentes primeiro, com contadores em camelCase e duração", async () => {
    const older = seedRun({
      trigger: "manual",
      startedAt: "2026-11-04T18:00:00.000Z",
      finishedAt: "2026-11-04T18:00:02.000Z",
      discovered: 5,
      created: 4,
      duplicate: 1,
    });
    const newer = seedRun({
      trigger: "scheduled",
      startedAt: "2026-11-05T18:00:00.000Z",
      finishedAt: "2026-11-05T18:00:04.500Z",
      status: "partial",
      discovered: 12,
      created: 9,
      duplicate: 2,
      errors: 1,
      summary: "1/2 fontes ok · 12 lidas · 9 novas · 2 duplicadas",
    });

    const res = await request(server.app).get("/api/v1/runs");
    expect(res.status).toBe(200);
    expect(res.body.runs.map((r: { id: number }) => r.id)).toEqual([newer, older]);

    const first = res.body.runs[0];
    expect(first).toMatchObject({
      id: newer,
      trigger: "scheduled",
      status: "partial",
      startedAt: "2026-11-05T18:00:00.000Z",
      finishedAt: "2026-11-05T18:00:04.500Z",
      durationMs: 4500,
      discoveredCount: 12,
      newCount: 9,
      updatedCount: 0,
      duplicateCount: 2,
      errorCount: 1,
      summary: "1/2 fontes ok · 12 lidas · 9 novas · 2 duplicadas",
    });
    expect(first).not.toHaveProperty("discovered_count");
  });

  it("execução em andamento tem finishedAt/durationMs nulos", async () => {
    seedRun({ startedAt: "2026-11-05T18:00:00.000Z", finishedAt: null });
    const res = await request(server.app).get("/api/v1/runs");
    expect(res.body.runs[0]).toMatchObject({
      status: "running",
      finishedAt: null,
      durationMs: null,
    });
  });

  it("respeita ?limit e rejeita limites inválidos", async () => {
    seedRun({ startedAt: "2026-11-03T18:00:00.000Z" });
    seedRun({ startedAt: "2026-11-04T18:00:00.000Z" });
    seedRun({ startedAt: "2026-11-05T18:00:00.000Z" });

    const limited = await request(server.app).get("/api/v1/runs?limit=2");
    expect(limited.status).toBe(200);
    expect(limited.body.runs).toHaveLength(2);

    for (const limit of ["0", "101", "abc"]) {
      const invalid = await request(server.app).get(`/api/v1/runs?limit=${limit}`);
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("inclui o conteúdo de data/last-run.json quando existe", async () => {
    const lastRun = {
      runId: 7,
      status: "success",
      trigger: "scheduled",
      discovered: 104,
      created: 103,
      duplicate: 1,
      summary: "2/2 fontes ok · 104 lidas · 103 novas · 1 duplicadas",
    };
    writeLastRun(lastRun);

    const res = await request(server.app).get("/api/v1/runs");
    expect(res.body.lastRun).toEqual(lastRun);
  });

  it("arquivo last-run.json inválido ou em formato inesperado não quebra a resposta", async () => {
    fs.writeFileSync(path.join(dataDir, "last-run.json"), "{ nao é json", "utf8");
    expect((await request(server.app).get("/api/v1/runs")).body.lastRun).toBeNull();

    writeLastRun([1, 2, 3]);
    expect((await request(server.app).get("/api/v1/runs")).body.lastRun).toBeNull();
  });
});

describe("GET /runs/:id — detalhe com execution_logs", () => {
  it("devolve a execução e os logs em ordem, com meta interpretado", async () => {
    const id = seedRun();
    insertExecutionLog(db(), {
      runId: id,
      jobType: "collect",
      level: "info",
      step: "fetch",
      message: "Buscando fonte remotive.",
      meta: { fonte: "remotive" },
    });
    insertExecutionLog(db(), {
      runId: id,
      jobType: "collect",
      level: "error",
      step: "fetch",
      message: "Fonte remoteok falhou: timeout.",
      meta: { fonte: "remoteok" },
    });
    // meta_json corrompido (gravado fora do helper) não pode derrubar a rota.
    db().run(
      `INSERT INTO execution_logs (run_id, job_type, level, step, message, meta_json, created_at)
       VALUES (?, 'collect', 'warn', 'persist', 'Meta inválido', '{quebrado', ?)`,
      [id, "2026-11-05T18:00:03.000Z"],
    );

    const res = await request(server.app).get(`/api/v1/runs/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.run).toMatchObject({ id, status: "success", newCount: 7 });
    expect(res.body.logs).toHaveLength(3);
    expect(res.body.logs.map((l: { message: string }) => l.message)).toEqual([
      "Buscando fonte remotive.",
      "Fonte remoteok falhou: timeout.",
      "Meta inválido",
    ]);
    expect(res.body.logs[0]).toMatchObject({
      level: "info",
      step: "fetch",
      meta: { fonte: "remotive" },
    });
    expect(res.body.logs[0].createdAt).toBeTypeOf("string");
    expect(res.body.logs[2].meta).toBeNull();
  });

  it("execução sem logs devolve lista vazia", async () => {
    const id = seedRun();
    const res = await request(server.app).get(`/api/v1/runs/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.logs).toEqual([]);
  });

  it("id inexistente → 404 e id inválido → 400", async () => {
    const missing = await request(server.app).get("/api/v1/runs/9999");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");

    for (const id of ["0", "-1", "abc"]) {
      const invalid = await request(server.app).get(`/api/v1/runs/${id}`);
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("GET /sources — fontes registradas", () => {
  it("lista as fontes com enabled booleano e estado de suporte", async () => {
    upsertSource(db(), {
      key: "remotive",
      name: "Remotive",
      kind: "api",
      supportState: "verified",
    });
    upsertSource(db(), {
      key: "remoteok",
      name: "Remote OK",
      kind: "api",
      supportState: "unverified",
    });

    const res = await request(server.app).get("/api/v1/sources");
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { key: string }) => s.key)).toEqual(["remoteok", "remotive"]);

    const remotive = res.body.items[1];
    expect(remotive).toMatchObject({
      key: "remotive",
      name: "Remotive",
      kind: "api",
      enabled: true,
      supportState: "verified",
    });
    expect(remotive.verifiedAt).toBeTypeOf("string");
    expect(res.body.items[0].verifiedAt).toBeNull();
  });
});
