import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findPossibleDuplicates, normalizeUrl } from "../../src/domain/dedupe.js";
import { createJob, deleteJob } from "../../src/services/jobs.js";
import { makeTestServer, type AppServer } from "../helpers.js";

let server: AppServer;
let cleanup: () => void;

beforeAll(() => {
  const created = makeTestServer();
  server = created.server;
  cleanup = created.cleanup;
});

afterAll(() => cleanup());

describe("normalizeUrl", () => {
  it("normaliza host, remove hash, utm_* e barra final", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Vagas/Node/?utm_source=x&id=1#topo")).toBe(
      "https://example.com/Vagas/Node?id=1",
    );
    expect(normalizeUrl("https://example.com/vagas/node/")).toBe("https://example.com/vagas/node");
  });

  it("aceita http e https; rejeita outros protocolos e URLs inválidas", () => {
    expect(normalizeUrl("http://example.com/a")).toBe("http://example.com/a");
    expect(normalizeUrl("ftp://example.com/a")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("não é url")).toBeNull();
  });
});

describe("findPossibleDuplicates", () => {
  it("detecta duplicata por URL normalizada (mesmo com utm e barra final)", () => {
    const ctx = server.ctx;
    const original = createJob(ctx, {
      title: "Dev Node",
      company: "Acme",
      sourceUrl: "https://empresa.com/vaga/1?utm_source=site",
    });

    const hits = findPossibleDuplicates(ctx.holder.get(), {
      title: "Outro cargo qualquer",
      company: "Outra empresa",
      sourceUrl: "https://empresa.com/vaga/1/?utm_campaign=feed",
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: original.id, reason: "url" });
  });

  it("apenas INDÍCIO para empresa+título iguais (não descarta automaticamente)", () => {
    const ctx = server.ctx;
    const created = createJob(ctx, { title: "Dev Pleno", company: "Similare Ltda" });

    const hits = findPossibleDuplicates(ctx.holder.get(), {
      title: "dev pleno",
      company: "SIMILARE LTDA",
    });

    const hit = hits.find((h) => h.id === created.id);
    expect(hit?.reason).toBe("empresa+titulo");
  });

  it("ignora candidatas sem título/empresa e respeita excludeJobId", () => {
    const ctx = server.ctx;
    const created = createJob(ctx, { title: "Dev Sênior", company: "Única SA" });

    expect(findPossibleDuplicates(ctx.holder.get(), { title: "Dev Sênior" })).toHaveLength(0);
    expect(
      findPossibleDuplicates(ctx.holder.get(), {
        title: "Dev Sênior",
        company: "Única SA",
        excludeJobId: created.id,
      }),
    ).toHaveLength(0);
  });

  it("não considera vagas excluídas (soft delete)", () => {
    const ctx = server.ctx;
    const created = createJob(ctx, {
      title: "Dev Excluída",
      company: "Sumiu SA",
      sourceUrl: "https://sumiu.com/vaga/9",
    });
    deleteJob(ctx, created.id);

    expect(
      findPossibleDuplicates(ctx.holder.get(), { sourceUrl: "https://sumiu.com/vaga/9" }),
    ).toHaveLength(0);
    expect(
      findPossibleDuplicates(ctx.holder.get(), { title: "Dev Excluída", company: "Sumiu SA" }),
    ).toHaveLength(0);
  });
});
