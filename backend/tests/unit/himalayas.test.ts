import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { HimalayasConnector } from "../../src/connectors/himalayas.js";
import { SourceError, type ConnectorContext } from "../../src/connectors/types.js";

/**
 * Testes OFFLINE com payload no formato real verificado em 2026-11-19
 * (ver docs/FONTES.md). Nenhuma requisição sai da máquina.
 */

const PUB_DATE = 1_795_000_000; // 2026-11-18
const FUTURE = 1_900_000_000; // 2030
const PAST = 1_000;

const JOB_A = {
  guid: "himalayas-1",
  title: "A.I. Engineering Intern",
  companyName: "Sezzle",
  employmentType: "Intern",
  locationRestrictions: ["Brazil"],
  description: "<p>Python, SQL e <strong>machine learning</strong>.</p><script>x()</script>",
  applicationLink: "https://himalayas.app/companies/sezzle/jobs/a-i-engineering-intern",
  pubDate: PUB_DATE,
  expiryDate: FUTURE,
  minSalary: 1000,
  maxSalary: 1000,
  currency: "USD",
  salaryPeriod: "monthly",
};

const JOB_B_EXPIRED = {
  guid: "himalayas-2",
  title: "Data Intern",
  companyName: "Old Co",
  employmentType: "Intern",
  locationRestrictions: ["Brazil"],
  description: "Vaga antiga.",
  applicationLink: "https://himalayas.app/companies/old/jobs/data-intern",
  pubDate: PUB_DATE,
  expiryDate: PAST,
};

const JOB_C = {
  guid: "himalayas-3",
  title: "Full Stack Developer Intern",
  companyName: "ASG Company",
  employmentType: "Intern",
  locationRestrictions: [],
  description: "React e Node.",
  applicationLink: "https://himalayas.app/companies/asg/jobs/full-stack-intern",
  pubDate: PUB_DATE,
  expiryDate: FUTURE,
  minSalary: 1500,
  maxSalary: 2500,
  currency: "USD",
  salaryPeriod: "monthly",
};

const JOB_D_DUPLICATE = { ...JOB_A, title: "A.I. Engineering Intern (repetida)" };

let server: http.Server;
let baseUrl: string;
let requests: Array<{ pathname: string; params: URLSearchParams }> = [];
let failStatus: number | null = null;
let badShape = false;
let emptyResponse = false;
let singlePageMode = false;
let invalidDateMode = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({ pathname: url.pathname, params: url.searchParams });

    if (url.pathname !== "/jobs/api/search") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"error":"not found"}');
      return;
    }

    if (failStatus !== null) {
      res.writeHead(failStatus, { "Content-Type": "application/json" });
      res.end('{"error":"erro"}');
      return;
    }

    if (badShape) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"totalCount":4}');
      return;
    }

    if (emptyResponse) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"totalCount":0,"limit":2,"offset":0,"jobs":[]}');
      return;
    }

    if (invalidDateMode) {
      const job = { ...JOB_A, guid: "himalayas-sem-data", pubDate: 0, expiryDate: undefined };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ totalCount: 1, limit: 20, offset: 0, jobs: [job] }));
      return;
    }

    if (singlePageMode) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ totalCount: 10, limit: 2, offset: 0, jobs: [JOB_A] }));
      return;
    }

    const page = Number(url.searchParams.get("page") ?? "1");
    const all = [JOB_A, JOB_B_EXPIRED, JOB_C, JOB_D_DUPLICATE];
    const limit = 2;
    const offset = (page - 1) * limit;
    const jobs = all.slice(offset, offset + limit);

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ totalCount: all.length, limit, offset, jobs }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests = [];
  failStatus = null;
  badShape = false;
  emptyResponse = false;
  singlePageMode = false;
  invalidDateMode = false;
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

function makeConnector(
  overrides: Partial<ConstructorParameters<typeof HimalayasConnector>[0]> = {},
) {
  return new HimalayasConnector({
    baseUrl,
    fetchOptions: { allowLoopbackForTests: true },
    ...overrides,
  });
}

async function collect(connector: HimalayasConnector, ctx = makeContext()) {
  const jobs = [];
  for await (const job of connector.fetch(ctx)) jobs.push(job);
  return jobs;
}

describe("HimalayasConnector — verificação e paginação", () => {
  it("verify() consulta Intern + BR na página 1 e aceita lista vazia", async () => {
    emptyResponse = true;
    await expect(makeConnector().verify()).resolves.toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.params.get("employment_type")).toBe("Intern");
    expect(requests[0]?.params.get("country")).toBe("BR");
    expect(requests[0]?.params.get("page")).toBe("1");
  });

  it("pagina até cobrir o total e para quando a página vem incompleta", async () => {
    const jobs = await collect(makeConnector());
    expect(jobs).toHaveLength(2);
    expect(requests.map((r) => r.params.get("page"))).toEqual(["1", "2"]);
  });

  it("não pede a próxima página quando a página veio incompleta", async () => {
    singlePageMode = true;
    const jobs = await collect(makeConnector());
    expect(jobs).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("respeita o teto de páginas", async () => {
    singlePageMode = true;
    const jobs = await collect(makeConnector({ maxPages: 1 }));
    expect(jobs).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });
});

describe("HimalayasConnector — mapeamento das vagas", () => {
  it("mapeia título, empresa, local, modalidade, tipo, salário, data e descrição", async () => {
    const jobs = await collect(makeConnector());
    const first = jobs.find((job) => job.externalId === "himalayas-1");

    expect(first).toMatchObject({
      externalId: "himalayas-1",
      sourceUrl: "https://himalayas.app/companies/sezzle/jobs/a-i-engineering-intern",
      title: "A.I. Engineering Intern",
      company: "Sezzle",
      location: "Brazil",
      workMode: "remote",
      contractType: "internship",
      salaryText: "USD 1.000/mês",
      postedAt: new Date(PUB_DATE * 1000).toISOString(),
    });
    expect(first?.descriptionText).toContain("Python");
    expect(first?.descriptionText).not.toContain("<");
    expect(first?.descriptionText).not.toContain("x()");
    expect(first?.raw).toBeTypeOf("object");
  });

  it("usa 'Remoto' quando não há restrição de país e formata faixa salarial", async () => {
    const jobs = await collect(makeConnector());
    const fullStack = jobs.find((job) => job.externalId === "himalayas-3");

    expect(fullStack?.location).toBe("Remoto");
    expect(fullStack?.salaryText).toBe("USD 1.500–2.500/mês");
  });

  it("mantém a data indefinida quando pubDate é inválida", async () => {
    invalidDateMode = true;
    const jobs = await collect(makeConnector());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.postedAt).toBeUndefined();
  });
});

describe("HimalayasConnector — descartes e limites", () => {
  it("descarta vaga expirada", async () => {
    const jobs = await collect(makeConnector());
    expect(jobs.map((job) => job.externalId)).not.toContain("himalayas-2");
  });

  it("deduplica por guid entre páginas", async () => {
    const jobs = await collect(makeConnector());
    expect(jobs.filter((job) => job.externalId === "himalayas-1")).toHaveLength(1);
  });

  it("respeita ctx.maxJobs", async () => {
    const jobs = await collect(makeConnector(), makeContext({ maxJobs: 1 }));
    expect(jobs).toHaveLength(1);
  });

  it("respeita ctx.signal já abortado (sem requisições)", async () => {
    const controller = new AbortController();
    controller.abort();
    const jobs = await collect(makeConnector(), makeContext({ signal: controller.signal }));

    expect(jobs).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it("propaga SourceError quando a API responde 429", async () => {
    failStatus = 429;
    await expect(collect(makeConnector())).rejects.toBeInstanceOf(SourceError);
  });

  it("rejeita resposta fora do formato esperado", async () => {
    badShape = true;
    await expect(collect(makeConnector())).rejects.toBeInstanceOf(SourceError);
  });
});
