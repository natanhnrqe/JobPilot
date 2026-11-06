import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { RemoteOkConnector } from "../../src/connectors/remoteok.js";
import { SourceError, type ConnectorContext } from "../../src/connectors/types.js";

/**
 * Testes OFFLINE com payload fixo: um servidor local serve um array idêntico
 * ao formato real verificado em 2026-11-04 (ver docs/FONTES.md). O primeiro
 * elemento é o aviso legal, como na API real. Nenhuma requisição sai da máquina.
 */

const FIXTURE = [
  {
    last_updated: 1793831119,
    legal:
      "API Terms of Service: Please link back (with follow, and without nofollow!) to the URL on Remote OK and mention Remote OK as a source.",
  },
  {
    id: "1137677",
    slug: "remote-ma-praktikum-intern-vogel-1137677",
    epoch: 1793721625,
    date: "2026-11-03T16:00:25+00:00",
    company: "Vogel",
    position: "M&A Praktikum Intern",
    tags: ["testing", "marketing"],
    description: "<p>Texto da vaga</p><script>alert('x')</script><ul><li>Excel</li></ul>",
    location: "München",
    salary_min: 4000,
    salary_max: 4000,
    url: "https://remoteOK.com/remote-jobs/remote-ma-praktikum-intern-vogel-1137677",
  },
  {
    id: 42,
    company: "Acme",
    position: "Front End Developer",
    date: "2026-11-01T10:00:00+00:00",
    description: "<ul><li>React</li></ul>",
    location: "Worldwide",
    tags: ["front end", "other"],
    salary_min: 3000,
    salary_max: 5000,
    url: "https://remoteOK.com/remote-jobs/front-end-developer-42",
  },
  {
    id: 43,
    company: "Sem URL",
    position: "Vaga sem URL",
    date: "2026-10-01T00:00:00+00:00",
  },
  {
    id: 44,
    company: "Sem Data",
    position: "Backend Developer",
    epoch: 1793721625,
    url: "https://remoteOK.com/remote-jobs/backend-developer-44",
  },
];

let server: http.Server;
let baseUrl: string;
let requestCount = 0;
let nextResponse: { status: number; contentType: string; body: string } = {
  status: 200,
  contentType: "application/json; charset=utf-8",
  body: JSON.stringify(FIXTURE),
};

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    requestCount++;
    res.writeHead(nextResponse.status, { "Content-Type": nextResponse.contentType });
    res.end(nextResponse.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeContext(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    runId: 1,
    signal: new AbortController().signal,
    maxJobs: 100,
    logger: { log: () => {} },
    ...overrides,
  };
}

function makeConnector() {
  return new RemoteOkConnector({
    endpoint: `${baseUrl}/api`,
    fetchOptions: { allowLoopbackForTests: true },
  });
}

async function collect(connector: RemoteOkConnector, ctx = makeContext()) {
  const jobs = [];
  for await (const job of connector.fetch(ctx)) jobs.push(job);
  return jobs;
}

function reset() {
  nextResponse = {
    status: 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(FIXTURE),
  };
}

describe("RemoteOkConnector — verificação e cache", () => {
  it("verify() confirma a API e devolve ok", async () => {
    expect(await makeConnector().verify()).toEqual({ ok: true });
  });

  it("verify() + fetch() compartilham o cache: UMA única requisição", async () => {
    requestCount = 0;
    const connector = makeConnector();
    await connector.verify();
    const jobs = await collect(connector);
    expect(jobs.length).toBeGreaterThan(0);
    expect(requestCount).toBe(1);
  });

  it("verify() devolve ok:false quando a resposta não é uma lista", async () => {
    nextResponse = { status: 200, contentType: "application/json", body: '{"erro":true}' };
    try {
      const result = await makeConnector().verify();
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/inesperada/i);
    } finally {
      reset();
    }
  });

  it("fetch() propaga SourceError quando o destino responde erro", async () => {
    nextResponse = { status: 429, contentType: "text/plain", body: "slow down" };
    const connector = makeConnector();
    try {
      await expect(
        (async () => {
          for await (const _ of connector.fetch(makeContext())) void _;
        })(),
      ).rejects.toBeInstanceOf(SourceError);
    } finally {
      reset();
    }
  });
});

describe("RemoteOkConnector — mapeamento das vagas", () => {
  it("ignora o aviso legal e vagas sem URL (não persiste lixo)", async () => {
    const jobs = await collect(makeConnector());
    // 5 elementos no fixture → 1 aviso legal + 1 sem URL = 3 vagas válidas.
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.title !== "Vaga sem URL")).toBe(true);
    expect(JSON.stringify(jobs)).not.toContain("Terms of Service");
  });

  it("mapeia os campos reais da fonte (id, empresa, local, salário, remoto)", async () => {
    const jobs = await collect(makeConnector());
    const first = jobs[0];
    expect(first).toMatchObject({
      externalId: "1137677",
      sourceUrl: "https://remoteOK.com/remote-jobs/remote-ma-praktikum-intern-vogel-1137677",
      title: "M&A Praktikum Intern",
      company: "Vogel",
      location: "München",
      workMode: "remote",
      contractType: "unknown", // a fonte não informa nível/tipo de contrato
      salaryText: "4000", // número como veio, sem inventar moeda
    });
    expect(first.raw).toBeTypeOf("object");
  });

  it("remove o HTML da descrição (sem tags nem scripts)", async () => {
    const jobs = await collect(makeConnector());
    expect(jobs[0]?.descriptionText).toContain("Texto da vaga");
    expect(jobs[0]?.descriptionText).toContain("- Excel");
    expect(jobs[0]?.descriptionText).not.toContain("<");
    expect(jobs[0]?.descriptionText).not.toContain("alert");
  });

  it("formata a faixa de salário quando mínimo e máximo diferem", async () => {
    const jobs = await collect(makeConnector());
    const frontEnd = jobs.find((j) => j.externalId === "42");
    expect(frontEnd?.salaryText).toBe("3000\u20135000");
  });

  it("normaliza a data (ISO com fuso) e usa epoch como fallback", async () => {
    const jobs = await collect(makeConnector());
    expect(jobs[0]?.postedAt).toBe("2026-11-03T16:00:25.000Z");
    const semData = jobs.find((j) => j.externalId === "44");
    expect(semData?.postedAt).toBe(new Date(1793721625 * 1000).toISOString());
  });
});

describe("RemoteOkConnector — limites", () => {
  it("respeita ctx.maxJobs", async () => {
    const jobs = await collect(makeConnector(), makeContext({ maxJobs: 1 }));
    expect(jobs).toHaveLength(1);
  });

  it("respeita ctx.signal (aborta a iteração)", async () => {
    const controller = new AbortController();
    controller.abort();
    const jobs = await collect(makeConnector(), makeContext({ signal: controller.signal }));
    expect(jobs).toHaveLength(0);
  });
});
