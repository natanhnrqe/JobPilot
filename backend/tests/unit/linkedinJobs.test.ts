import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { LinkedInJobsConnector } from "../../src/connectors/linkedinJobs.js";
import { SourceError, type ConnectorContext } from "../../src/connectors/types.js";

/**
 * Testes OFFLINE com payload no formato real verificado em 2026-11-14
 * (ver docs/RAPIDAPI.md). Nenhuma requisição sai da máquina.
 */

const CURITIBA = '"Curitiba"';
const BRASIL = '"Brazil"';

const FX_CURITIBA = [
  {
    id: 101,
    title: "Estágio em Desenvolvimento",
    organization: "Acme",
    url: "https://br.linkedin.com/jobs/view/1",
    locations_derived: ["Curitiba, Paraná, Brazil"],
    location_type: null,
    employment_type: ["INTERN"],
    seniority: "Estágio",
    date_posted: "2026-11-13T17:44:55",
    description_text: "<p>Requisitos: <strong>Java</strong> e Spring.</p><script>x()</script>",
    salary: "R$ 1.800,00",
    ai_work_arrangement: "On-site",
  },
  {
    id: 102,
    title: "Estagiário de Dados",
    organization: "Beta",
    url: "https://br.linkedin.com/jobs/view/2",
    locations_derived: ["Curitiba, Paraná, Brazil"],
    employment_type: ["FULL_TIME"],
    seniority: null,
    date_posted: "2026-11-13T12:28:12.622",
    description_text: "Python e SQL.",
    ai_work_arrangement: "Hybrid",
    ai_salary_currency: "BRL",
    ai_salary_min_value: 1500,
    ai_salary_max_value: 2000,
    ai_salary_unit_text: "MONTH",
  },
  {
    id: 103,
    title: "Estágio Remoto em TI",
    organization: "Gama",
    url: "https://br.linkedin.com/jobs/view/3",
    locations_derived: ["Brazil"],
    location_type: "TELECOMMUTE",
    seniority: "Estágio",
    ai_work_arrangement: null,
  },
  { id: 104, title: "", url: "https://br.linkedin.com/jobs/view/4" },
  { id: 105, title: "Estágio sem link" },
  {
    id: 101,
    title: "Estágio em Desenvolvimento (duplicado)",
    url: "https://br.linkedin.com/jobs/view/1-duplicado",
  },
];

const FX_REMOTO = [
  {
    id: 101,
    title: "Estágio em Desenvolvimento",
    url: "https://br.linkedin.com/jobs/view/1-outra-consulta",
  },
  {
    id: 201,
    title: "Estágio em Dados",
    organization: "Remote Co",
    url: "https://br.linkedin.com/jobs/view/201",
    locations_derived: ["Brazil"],
    seniority: "Estágio",
    date_posted: "2026-11-13T22:08:52.584",
    ai_work_arrangement: "Remote Solely",
  },
  {
    id: 202,
    title: "Estágio em Marketing",
    organization: "Editora",
    url: "https://br.linkedin.com/jobs/view/202",
    locations_derived: ["São Paulo, São Paulo, Brazil"],
    employment_type: ["INTERN"],
    ai_work_arrangement: "Remote OK",
  },
];

let server: http.Server;
let baseUrl: string;
let requests: Array<{
  pathname: string;
  params: URLSearchParams;
  headers: http.IncomingHttpHeaders;
}> = [];
let failStatus: number | null = null;
let badShape = false;
let emptyResponse = false;
let tempDir: string | null = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({ pathname: url.pathname, params: url.searchParams, headers: req.headers });

    if (url.pathname !== "/active-jb") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"message":"not found"}');
      return;
    }

    if (failStatus !== null) {
      res.writeHead(failStatus, { "Content-Type": "application/json" });
      res.end('{"message":"erro"}');
      return;
    }

    if (badShape) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"status":"OK"}');
      return;
    }

    if (emptyResponse) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
      return;
    }

    const location = url.searchParams.get("location");
    const body = location === CURITIBA ? FX_CURITIBA : location === BRASIL ? FX_REMOTO : [];
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
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
});

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function cacheFile(): string {
  tempDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-linkedin-"));
  return path.join(tempDir, "linkedin-jobs.json");
}

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
  overrides: Partial<ConstructorParameters<typeof LinkedInJobsConnector>[0]> = {},
) {
  return new LinkedInJobsConnector({
    baseUrl,
    apiKey: "chave-de-teste",
    fetchOptions: { allowLoopbackForTests: true },
    ...overrides,
  });
}

async function collect(connector: LinkedInJobsConnector, ctx = makeContext()) {
  const jobs = [];
  for await (const job of connector.fetch(ctx)) jobs.push(job);
  return jobs;
}

describe("LinkedInJobsConnector — verificação, consultas e cache", () => {
  it("verify() usa a consulta de Curitiba e aceita lista vazia", async () => {
    emptyResponse = true;
    await expect(makeConnector().verify()).resolves.toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.params.get("location")).toBe(CURITIBA);
  });

  it("verify() + fetch() reaproveitam o cache da primeira consulta", async () => {
    const connector = makeConnector();
    await connector.verify();
    const jobs = await collect(connector);

    expect(jobs.length).toBe(5);
    expect(requests.map((r) => r.params.get("location"))).toEqual([CURITIBA, BRASIL]);
  });

  it("envia cabeçalhos e parâmetros que cabem na cota gratuita", async () => {
    await collect(makeConnector());

    const first = requests[0];
    expect(first?.headers["x-rapidapi-key"]).toBe("chave-de-teste");
    expect(first?.headers["x-rapidapi-host"]).toBe("linkedin-job-search-api.p.rapidapi.com");
    expect(first?.params.get("time_frame")).toBe("7d");
    expect(first?.params.get("limit")).toBe("20");
    expect(first?.params.get("offset")).toBe("0");
    expect(first?.params.get("description_format")).toBe("text");
    expect(first?.params.get("title")).toBe('"estágio" OR "estagiário"');
    expect(first?.params.get("ai_work_arrangement")).toBeNull();

    const second = requests[1];
    expect(second?.params.get("location")).toBe(BRASIL);
    expect(second?.params.get("ai_work_arrangement")).toBe("Remote OK,Remote Solely");
  });

  it("cache em arquivo evita nova requisição em outra execução", async () => {
    const file = cacheFile();
    const first = await collect(makeConnector({ cacheFile: file }));
    expect(requests).toHaveLength(2);

    const second = await collect(makeConnector({ cacheFile: file }));
    expect(requests).toHaveLength(2);
    expect(second.map((job) => job.externalId)).toEqual(first.map((job) => job.externalId));
  });

  it("cache corrompido é ignorado e a API é consultada", async () => {
    const file = cacheFile();
    fs.writeFileSync(file, "{ nao é json", "utf8");

    const jobs = await collect(makeConnector({ cacheFile: file }));
    expect(jobs.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(2);
  });

  it("cache expirado volta a consultar a API", async () => {
    const file = cacheFile();
    let now = 1_000_000;
    await collect(makeConnector({ cacheFile: file, now: () => now }));

    now += 7 * 24 * 60 * 60 * 1000;
    await collect(makeConnector({ cacheFile: file, now: () => now }));

    expect(requests).toHaveLength(4);
  });

  it("verify() devolve ok:false sem consultas configuradas", async () => {
    const result = await makeConnector({ queries: [] }).verify();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/consulta/i);
    expect(requests).toHaveLength(0);
  });
});

describe("LinkedInJobsConnector — mapeamento das vagas", () => {
  it("mapeia título, empresa, local, modalidade, tipo, bolsa e descrição", async () => {
    const jobs = await collect(makeConnector());
    const first = jobs.find((job) => job.externalId === "101");

    expect(first).toMatchObject({
      externalId: "101",
      sourceUrl: "https://br.linkedin.com/jobs/view/1",
      title: "Estágio em Desenvolvimento",
      company: "Acme",
      location: "Curitiba, Paraná, Brazil",
      workMode: "onsite",
      contractType: "internship",
      salaryText: "R$ 1.800,00",
      postedAt: "2026-11-13T17:44:55.000Z",
    });
    expect(first?.descriptionText).toContain("Java");
    expect(first?.descriptionText).not.toContain("<");
    expect(first?.descriptionText).not.toContain("x()");
    expect(first?.raw).toBeTypeOf("object");
  });

  it("infere estágio pelo título mesmo com employment_type FULL_TIME", async () => {
    const jobs = await collect(makeConnector());
    const data = jobs.find((job) => job.externalId === "102");

    expect(data?.contractType).toBe("internship");
    expect(data?.workMode).toBe("hybrid");
    // Estimativa de IA não vira salário.
    expect(data?.salaryText).toBeUndefined();
  });

  it("marca TELECOMMUTE como remoto e usa a data com milissegundos", async () => {
    const jobs = await collect(makeConnector());
    const ti = jobs.find((job) => job.externalId === "103");
    const remote = jobs.find((job) => job.externalId === "201");

    expect(ti?.workMode).toBe("remote");
    expect(remote?.workMode).toBe("remote");
    expect(remote?.postedAt).toBe("2026-11-13T22:08:52.584Z");
  });

  it("deduplica entre as consultas e descarta vaga sem título ou link", async () => {
    const jobs = await collect(makeConnector());
    const ids = jobs.map((job) => job.externalId);

    expect(ids).toEqual(["101", "102", "103", "201", "202"]);
    expect(ids).not.toContain("104");
    expect(ids).not.toContain("105");
    expect(ids.filter((id) => id === "101")).toHaveLength(1);
  });

  it("respeita ctx.maxJobs", async () => {
    const jobs = await collect(makeConnector(), makeContext({ maxJobs: 2 }));
    expect(jobs).toHaveLength(2);
  });
});

describe("LinkedInJobsConnector — limites e falhas", () => {
  it("respeita ctx.signal já abortado (sem requisições)", async () => {
    const controller = new AbortController();
    controller.abort();
    const jobs = await collect(makeConnector(), makeContext({ signal: controller.signal }));

    expect(jobs).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it("sem chave, fetch() lança SourceError e nem tenta a rede", async () => {
    const connector = makeConnector({ apiKey: "" });
    await expect(collect(connector)).rejects.toBeInstanceOf(SourceError);
    expect(requests).toHaveLength(0);
    await expect(connector.verify()).resolves.toMatchObject({ ok: false });
  });

  it("propaga SourceError quando a API responde 429", async () => {
    failStatus = 429;
    await expect(collect(makeConnector())).rejects.toBeInstanceOf(SourceError);
  });

  it("rejeita resposta fora do formato esperado", async () => {
    badShape = true;
    await expect(collect(makeConnector())).rejects.toBeInstanceOf(SourceError);
  });

  it("recusa chave com CR/LF antes de qualquer requisição", async () => {
    const connector = makeConnector({ apiKey: "chave\r\nX-Evil: 1" });
    await expect(collect(connector)).rejects.toBeInstanceOf(SourceError);
    expect(requests).toHaveLength(0);
  });
});
