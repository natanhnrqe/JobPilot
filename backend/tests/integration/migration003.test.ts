import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { createJob, deleteJob, getJobDetail } from "../../src/services/jobs.js";
import {
  countExecutionLogs,
  findSourceByKey,
  finishSearchRun,
  insertExecutionLog,
  insertSearchRun,
  listSearchRuns,
  upsertSource,
} from "../../src/repositories/sources.js";
import { findJobByExternalId } from "../../src/repositories/jobs.js";
import { makeTestServer, type AppServer } from "../helpers.js";

let server: AppServer;
let cleanup: () => void;

beforeAll(() => {
  const created = makeTestServer();
  server = created.server;
  cleanup = created.cleanup;
});

afterAll(() => cleanup());

describe("Migração 003 — fontes, execuções e logs de coleta", () => {
  it("aplica as migrações de forma idempotente (segunda execução não reexecuta)", () => {
    const db = server.ctx.holder.get();
    const migrationsDir = `${server.ctx.config.backendDir}/migrations`;

    const secondRun = runMigrations(db, migrationsDir);
    expect(secondRun).toHaveLength(0);

    const versions = db.all<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(versions.map((v) => v.version)).toContain(3);
  });

  it("cria as tabelas sources, search_runs e execution_logs com as colunas esperadas", () => {
    const db = server.ctx.holder.get();
    const tables = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["sources", "search_runs", "execution_logs"]));

    const jobCols = db.all<{ name: string }>("PRAGMA table_info(jobs)").map((c) => c.name);
    expect(jobCols).toEqual(expect.arrayContaining(["source_id", "external_id", "posted_at"]));
  });

  it("adiciona o índice parcial ux_jobs_source_external (só vagas ativas)", () => {
    const db = server.ctx.holder.get();
    const indexes = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")
      .map((i) => i.name);
    expect(indexes).toContain("ux_jobs_source_external");
  });
});

describe("Repositório de fontes (sources)", () => {
  it("upsertSource insere uma vez e reutiliza o mesmo id depois", () => {
    const db = server.ctx.holder.get();
    const first = upsertSource(db, {
      key: "remotive",
      name: "Remotive",
      kind: "api",
      supportState: "verified",
      notes: "API pública verificada em 2026-11-03",
    });
    const second = upsertSource(db, {
      key: "remotive",
      name: "Remotive (atualizado)",
      kind: "api",
      supportState: "verified",
    });

    expect(typeof first).toBe("number");
    expect(second).toBe(first);

    const row = findSourceByKey(db, "remotive");
    expect(row).toMatchObject({
      id: first,
      key: "remotive",
      name: "Remotive (atualizado)",
      support_state: "verified",
      enabled: 1,
    });
    // notes antigo é preservado quando o novo upsert não informa notes.
    expect(row?.notes).toBe("API pública verificada em 2026-11-03");
  });

  it("findSourceByKey devolve undefined para chave inexistente", () => {
    const db = server.ctx.holder.get();
    expect(findSourceByKey(db, "nao-existe")).toBeUndefined();
  });
});

describe("Execuções de coleta (search_runs + execution_logs)", () => {
  it("registra uma execução, grava logs e fecha com contadores", () => {
    const db = server.ctx.holder.get();
    const runId = insertSearchRun(db, { trigger: "manual", startedAt: new Date().toISOString() });

    insertExecutionLog(db, {
      runId,
      jobType: "collect",
      level: "info",
      step: "fetch",
      message: "Buscando fonte remotive",
      meta: { fonte: "remotive" },
    });
    insertExecutionLog(db, {
      runId,
      jobType: "collect",
      level: "error",
      step: "fetch",
      message: "Falha em remoteok",
    });

    expect(countExecutionLogs(db, runId)).toBe(2);

    finishSearchRun(db, runId, {
      status: "partial",
      finishedAt: new Date().toISOString(),
      discovered: 10,
      created: 3,
      updated: 0,
      duplicate: 7,
      errors: 1,
      summary: "1 de 2 fontes falhou",
    });

    const runs = listSearchRuns(db);
    const run = runs.find((r) => r.id === runId);
    expect(run).toMatchObject({
      trigger: "manual",
      status: "partial",
      discovered_count: 10,
      new_count: 3,
      duplicate_count: 7,
      error_count: 1,
      summary: "1 de 2 fontes falhou",
    });
    expect(run?.finished_at).not.toBeNull();
  });
});

describe("jobs.source_id + jobs.external_id (migração 003)", () => {
  it("persiste e devolve sourceId/externalId no DTO", () => {
    const db = server.ctx.holder.get();
    const sourceId = upsertSource(db, {
      key: "remoteok",
      name: "Remote OK",
      kind: "api",
      supportState: "verified",
    });

    const job = createJob(server.ctx, {
      title: "Junior Dev",
      company: "Empresa Fonte",
      sourceId,
      externalId: "ro-123",
      sourceUrl: "https://remoteok.com/remote-jobs/junior-dev",
    });

    expect(job.sourceId).toBe(sourceId);
    expect(job.externalId).toBe("ro-123");
    expect(getJobDetail(server.ctx, job.id)).toMatchObject({
      sourceId,
      externalId: "ro-123",
    });

    const found = findJobByExternalId(db, sourceId, "ro-123");
    expect(found?.id).toBe(job.id);
  });

  it("cadastro manual continua com sourceId/externalId null (compatibilidade)", () => {
    const job = createJob(server.ctx, { title: "Vaga Manual", company: "Manual SA" });
    expect(job.sourceId).toBeNull();
    expect(job.externalId).toBeNull();
  });

  it("índice único impede duplicata source+external e libera após exclusão lógica", () => {
    const db = server.ctx.holder.get();
    const sourceId = upsertSource(db, {
      key: "arbeitnow",
      name: "Arbeitnow",
      kind: "api",
      supportState: "verified",
    });

    const first = createJob(server.ctx, {
      title: "Dev Remoto",
      company: "Co",
      sourceId,
      externalId: "an-1",
    });

    // Segunda vaga com o MESMO source+external → violação do índice.
    expect(() =>
      createJob(server.ctx, {
        title: "Dev Remoto (copy)",
        company: "Co",
        sourceId,
        externalId: "an-1",
      }),
    ).toThrow();

    // Após exclusão lógica, a coleta pode recriar a vaga.
    deleteJob(server.ctx, first.id);
    const recreated = createJob(server.ctx, {
      title: "Dev Remoto",
      company: "Co",
      sourceId,
      externalId: "an-1",
    });
    expect(recreated.id).not.toBe(first.id);
    expect(findJobByExternalId(db, sourceId, "an-1")?.id).toBe(recreated.id);
  });
});
