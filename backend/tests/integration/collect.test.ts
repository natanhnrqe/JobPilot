import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestServer, type AppServer } from "../helpers.js";
import { runCollect } from "../../src/services/collect.js";
import { SourceError, type ConnectorContext, type RawJob } from "../../src/connectors/types.js";
import type { SourceConnector } from "../../src/connectors/types.js";
import {
  countExecutionLogs,
  findSourceByKey,
  listSearchRuns,
  upsertSource,
} from "../../src/repositories/sources.js";

/**
 * Testes OFFLINE da execução de coleta (Seção 7.2): conectores falsos com
 * respostas fixas, banco SQLite temporário por teste. Nenhuma requisição de
 * rede é feita.
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

interface FakeConnectorOptions {
  key?: string;
  name?: string;
  jobs?: RawJob[];
  failVerify?: string;
  failFetch?: string;
}

interface FakeConnector extends SourceConnector {
  fetchCount(): number;
  lastContext(): ConnectorContext | null;
}

function fakeConnector(opts: FakeConnectorOptions = {}): FakeConnector {
  const key = opts.key ?? "fonte-a";
  let fetches = 0;
  let lastContext: ConnectorContext | null = null;

  return {
    key,
    name: opts.name ?? `Fonte ${key}`,
    kind: "api",
    supportState: "verified",
    async verify() {
      return opts.failVerify ? { ok: false, reason: opts.failVerify } : { ok: true };
    },
    async *fetch(ctx: ConnectorContext) {
      fetches++;
      lastContext = ctx;
      if (opts.failFetch) throw new SourceError("network", opts.failFetch);
      for (const job of opts.jobs ?? []) {
        if (ctx.signal.aborted) return;
        yield job;
      }
    },
    fetchCount: () => fetches,
    lastContext: () => lastContext,
  };
}

function rawJob(title: string, sourceUrl: string, extra: Partial<RawJob> = {}): RawJob {
  return { title, sourceUrl, descriptionText: "Descrição da vaga.", raw: {}, ...extra };
}

function db() {
  return server.ctx.holder.get();
}

function jobRows() {
  return db().all<{ id: number; posted_at: string | null; source_id: number | null }>(
    "SELECT id, posted_at, source_id FROM jobs ORDER BY id",
  );
}

describe("Execução de coleta — gravação e reexecução", () => {
  it("primeira execução grava as vagas e fecha a execução com contadores", async () => {
    const connector = fakeConnector({
      key: "fonte-a",
      jobs: [
        rawJob("Dev Júnior", "https://fonte-a.example.com/vagas/1", {
          externalId: "a-1",
          company: "Acme",
          postedAt: "2026-01-10T12:00:00.000Z",
        }),
        rawJob("Estágio Backend", "https://fonte-a.example.com/vagas/2", {
          externalId: "a-2",
          company: "Beta",
        }),
      ],
    });

    const result = await runCollect(server.ctx, { connectors: [connector], trigger: "manual" });

    expect(result.status).toBe("success");
    expect(result.discovered).toBe(2);
    expect(result.created).toBe(2);
    expect(result.duplicate).toBe(0);
    expect(result.exitCode).toBe(0);

    const rows = jobRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.source_id).toBeGreaterThan(0);
    expect(rows[0]?.posted_at).toBe("2026-01-10T12:00:00.000Z");

    const run = listSearchRuns(db())[0];
    expect(run).toMatchObject({
      id: result.runId,
      trigger: "manual",
      status: "success",
      discovered_count: 2,
      new_count: 2,
      duplicate_count: 0,
      error_count: 0,
    });
    expect(run?.finished_at).not.toBeNull();
    expect(countExecutionLogs(db(), result.runId)).toBeGreaterThan(0);

    // Fonte registrada (migração 003) com o estado declarado pelo conector.
    expect(findSourceByKey(db(), "fonte-a")?.support_state).toBe("verified");

    // Resumo para o dashboard (Seção 7.4).
    const lastRun = JSON.parse(
      fs.readFileSync(path.join(dataDir, "last-run.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(lastRun).toMatchObject({ runId: result.runId, status: "success", created: 2 });
  });

  it("reexecutar não duplica vagas (new_count = 0, duplicate_count correto)", async () => {
    const jobs = [
      rawJob("Dev Júnior", "https://fonte-a.example.com/vagas/1", {
        externalId: "a-1",
        company: "Acme",
      }),
    ];

    await runCollect(server.ctx, { connectors: [fakeConnector({ jobs })], trigger: "manual" });
    const second = await runCollect(server.ctx, {
      connectors: [fakeConnector({ jobs })],
      trigger: "manual",
    });

    expect(second.discovered).toBe(1);
    expect(second.created).toBe(0);
    expect(second.duplicate).toBe(1);
    expect(jobRows()).toHaveLength(1);

    const run = listSearchRuns(db())[0];
    expect(run).toMatchObject({ status: "success", new_count: 0, duplicate_count: 1 });
  });
});

describe("Execução de coleta — deduplicação", () => {
  it("deduplica por URL normalizada mesmo com id externo diferente", async () => {
    await runCollect(server.ctx, {
      connectors: [
        fakeConnector({
          key: "fonte-a",
          jobs: [
            rawJob("Dev", "https://fonte-a.example.com/vagas/1?utm_source=x", {
              externalId: "a-1",
            }),
          ],
        }),
      ],
      trigger: "manual",
    });

    const second = await runCollect(server.ctx, {
      connectors: [
        fakeConnector({
          key: "fonte-a",
          jobs: [rawJob("Dev", "https://fonte-a.example.com/vagas/1", { externalId: "a-2" })],
        }),
      ],
      trigger: "manual",
    });

    expect(second.created).toBe(0);
    expect(second.duplicate).toBe(1);
    expect(jobRows()).toHaveLength(1);
  });

  it("deduplica por empresa+título+localização entre fontes diferentes", async () => {
    await runCollect(server.ctx, {
      connectors: [
        fakeConnector({
          key: "fonte-a",
          jobs: [
            rawJob("Dev Júnior", "https://fonte-a.example.com/vagas/1", {
              externalId: "a-1",
              company: "Acme",
              location: "Remoto",
            }),
          ],
        }),
      ],
      trigger: "manual",
    });

    const second = await runCollect(server.ctx, {
      connectors: [
        fakeConnector({
          key: "fonte-b",
          jobs: [
            rawJob("Dev Júnior", "https://fonte-b.example.com/vagas/9", {
              externalId: "b-9",
              company: "Acme",
              location: "Remoto",
            }),
          ],
        }),
      ],
      trigger: "manual",
    });

    expect(second.created).toBe(0);
    expect(second.duplicate).toBe(1);
    expect(jobRows()).toHaveLength(1);
  });

  it("empresa+título iguais com localizações diferentes NÃO descarta a vaga", async () => {
    await runCollect(server.ctx, {
      connectors: [
        fakeConnector({
          key: "fonte-a",
          jobs: [
            rawJob("Dev Júnior", "https://fonte-a.example.com/vagas/1", {
              externalId: "a-1",
              company: "Acme",
              location: "São Paulo",
            }),
          ],
        }),
      ],
      trigger: "manual",
    });

    const second = await runCollect(server.ctx, {
      connectors: [
        fakeConnector({
          key: "fonte-b",
          jobs: [
            rawJob("Dev Júnior", "https://fonte-b.example.com/vagas/9", {
              externalId: "b-9",
              company: "Acme",
              location: "Remoto",
            }),
          ],
        }),
      ],
      trigger: "manual",
    });

    expect(second.created).toBe(1);
    expect(jobRows()).toHaveLength(2);
  });
});

describe("Execução de coleta — falhas e isolamento por fonte", () => {
  it("falha de uma fonte gera status partial e as demais gravam", async () => {
    const good = fakeConnector({
      key: "boa",
      jobs: [rawJob("Dev", "https://boa.example.com/vagas/1", { externalId: "g-1" })],
    });
    const bad = fakeConnector({ key: "ruim", failFetch: "HTTP 429 (fixture)" });

    const result = await runCollect(server.ctx, { connectors: [good, bad], trigger: "manual" });

    expect(result.status).toBe("partial");
    expect(result.errors).toBe(1);
    expect(result.created).toBe(1);
    expect(result.exitCode).toBe(0);
    expect(jobRows()).toHaveLength(1);

    const run = listSearchRuns(db())[0];
    expect(run).toMatchObject({ status: "partial", new_count: 1, error_count: 1 });

    const errorLogs = db().all(
      "SELECT id FROM execution_logs WHERE run_id = ? AND level = 'error'",
      [result.runId],
    );
    expect(errorLogs.length).toBeGreaterThan(0);
  });

  it("fonte que falha na verificação não é buscada e o resultado fica failed", async () => {
    const bad = fakeConnector({
      key: "ruim",
      failVerify: "API indisponível (fixture)",
      jobs: [rawJob("Dev", "https://ruim.example.com/vagas/1")],
    });

    const result = await runCollect(server.ctx, { connectors: [bad], trigger: "manual" });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(bad.fetchCount()).toBe(0);
    expect(jobRows()).toHaveLength(0);
  });

  it("fonte desabilitada pelo usuário não é executada", async () => {
    upsertSource(db(), { key: "fonte-a", name: "Fonte A", kind: "api", supportState: "verified" });
    db().run("UPDATE sources SET enabled = 0 WHERE key = 'fonte-a'");

    const connector = fakeConnector({
      key: "fonte-a",
      jobs: [rawJob("Dev", "https://fonte-a.example.com/vagas/1")],
    });
    const result = await runCollect(server.ctx, { connectors: [connector], trigger: "manual" });

    expect(connector.fetchCount()).toBe(0);
    expect(result.sources[0]?.status).toBe("skipped");
    expect(result.created).toBe(0);
    expect(jobRows()).toHaveLength(0);
  });
});

describe("Execução de coleta — lock, limites e normalização", () => {
  it("lock ativo → execução skipped/concurrent, nenhuma fonte é chamada e exit 0", async () => {
    fs.writeFileSync(
      path.join(dataDir, ".lock"),
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
      "utf8",
    );

    const connector = fakeConnector({
      key: "fonte-a",
      jobs: [rawJob("Dev", "https://fonte-a.example.com/vagas/1")],
    });
    const result = await runCollect(server.ctx, { connectors: [connector], trigger: "scheduled" });

    expect(result.status).toBe("skipped");
    expect(result.summary).toBe("concurrent");
    expect(result.exitCode).toBe(0);
    expect(connector.fetchCount()).toBe(0);
    expect(jobRows()).toHaveLength(0);

    const run = listSearchRuns(db())[0];
    expect(run).toMatchObject({ status: "skipped", trigger: "scheduled", summary: "concurrent" });
  });

  it("respeita MAX_JOBS_PER_RUN e repassa o limite ao conector", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) =>
      rawJob(`Vaga ${i}`, `https://fonte-a.example.com/vagas/${i}`, { externalId: `a-${i}` }),
    );
    const connector = fakeConnector({ key: "fonte-a", jobs });

    const result = await runCollect(server.ctx, {
      connectors: [connector],
      trigger: "manual",
      maxJobsPerRun: 2,
    });

    expect(connector.lastContext()?.maxJobs).toBe(2);
    expect(result.discovered).toBe(2);
    expect(result.created).toBe(2);
    expect(jobRows()).toHaveLength(2);
  });

  it("vaga sem título ou com URL não http(s) é ignorada sem quebrar a coleta", async () => {
    const connector = fakeConnector({
      key: "fonte-a",
      jobs: [
        rawJob("   ", "https://fonte-a.example.com/vagas/1", { externalId: "x" }),
        rawJob("Vaga Suspeita", "javascript:alert(1)", { externalId: "y" }),
        rawJob("Vaga Boa", "https://fonte-a.example.com/vagas/2", { externalId: "z" }),
      ],
    });

    const result = await runCollect(server.ctx, { connectors: [connector], trigger: "manual" });

    expect(result.status).toBe("success");
    expect(result.discovered).toBe(3);
    expect(result.created).toBe(1);
    expect(jobRows()).toHaveLength(1);
  });

  it("não inventa data de publicação quando a fonte não informa", async () => {
    const connector = fakeConnector({
      key: "fonte-a",
      jobs: [
        rawJob("Sem data", "https://fonte-a.example.com/vagas/1", { externalId: "a-1" }),
        rawJob("Data inválida", "https://fonte-a.example.com/vagas/2", {
          externalId: "a-2",
          postedAt: "ontem",
        }),
      ],
    });

    await runCollect(server.ctx, { connectors: [connector], trigger: "manual" });

    const rows = jobRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.posted_at === null)).toBe(true);
  });
});
