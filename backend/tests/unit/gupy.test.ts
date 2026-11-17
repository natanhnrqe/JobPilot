import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { GupyConnector } from "../../src/connectors/gupy.js";
import { SourceError, type ConnectorContext } from "../../src/connectors/types.js";

/**
 * Testes OFFLINE com payload no formato real verificado em 2026-11-16
 * (ver docs/FONTES.md). Nenhuma requisição sai da máquina.
 */

const CURITIBA = "Curitiba";
const REMOTE = "remote";

const FX_CURITIBA_PAGE_1 = [
  {
    id: 101,
    name: "Estágio em Desenvolvimento",
    description: "<p>Requisitos: <strong>Java</strong> e Spring.</p><script>x()</script>",
    careerPageName: "Acme",
    careerPageUrl: "https://acme.gupy.io/",
    type: "vacancy_type_internship",
    publishedDate: "2026-11-16T21:42:56.686Z",
    workplaceType: "on-site",
    city: "Curitiba",
    state: "Paraná",
    jobUrl: "https://acme.gupy.io/jobs/101",
  },
  {
    id: 102,
    name: "Estágio em Direito",
    description: "Contratos e compliance.",
    careerPageName: "Beta",
    type: "vacancy_type_internship",
    publishedDate: "2026-11-15T12:00:00.000Z",
    workplaceType: "hybrid",
    city: "Curitiba",
    state: "Paraná",
    jobUrl: "https://beta.gupy.io/jobs/102",
  },
];

const FX_CURITIBA_PAGE_2 = [
  {
    id: 103,
    name: "Banco de Talentos - Estágio",
    description: "Cadastro reserva.",
    careerPageName: "Gama",
    type: "vacancy_type_talent_pool",
    workplaceType: "on-site",
    city: "Curitiba",
    state: "Paraná",
    jobUrl: "https://gama.gupy.io/jobs/103",
  },
];

const FX_REMOTE = [
  {
    id: 101,
    name: "Estágio em Desenvolvimento (duplicado)",
    careerPageName: "Acme",
    type: "vacancy_type_internship",
    workplaceType: "remote",
    city: "",
    state: "",
    jobUrl: "https://acme.gupy.io/jobs/101-outra",
  },
  {
    id: 201,
    name: "Estágio em Dados",
    description: "Python e SQL.",
    careerPageName: "Remote Co",
    type: "vacancy_type_internship",
    publishedDate: "2026-11-16T10:00:00.000Z",
    workplaceType: "remote",
    city: "",
    state: "",
    jobUrl: "https://remoteco.gupy.io/jobs/201",
  },
  {
    id: 202,
    name: "Estágio sem link",
    type: "vacancy_type_internship",
  },
];

let server: http.Server;
let baseUrl: string;
let requests: Array<{ pathname: string; params: URLSearchParams }> = [];
let failStatus: number | null = null;
let badShape = false;
let emptyResponse = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({ pathname: url.pathname, params: url.searchParams });

    if (url.pathname !== "/api/job-search/jobs") {
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
      res.end('{"pagination":{"total":0}}');
      return;
    }

    if (emptyResponse) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"data":[],"pagination":{"total":0,"limit":1,"offset":0}}');
      return;
    }

    const limit = Number(url.searchParams.get("limit") ?? "100");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const city = url.searchParams.get("city");
    const workplaceType = url.searchParams.get("workplaceType");

    let all: unknown[] = [];
    if (city === CURITIBA) all = [...FX_CURITIBA_PAGE_1, ...FX_CURITIBA_PAGE_2];
    else if (workplaceType === REMOTE) all = FX_REMOTE;

    const page = all.slice(offset, offset + limit);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ data: page, pagination: { total: all.length, limit, offset } }));
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

function makeContext(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    runId: 1,
    signal: new AbortController().signal,
    maxJobs: 100,
    logger: { log: () => {} },
    ...overrides,
  };
}

function makeConnector(overrides: Partial<ConstructorParameters<typeof GupyConnector>[0]> = {}) {
  return new GupyConnector({
    baseUrl,
    fetchOptions: { allowLoopbackForTests: true },
    ...overrides,
  });
}

async function collect(connector: GupyConnector, ctx = makeContext()) {
  const jobs = [];
  for await (const job of connector.fetch(ctx)) jobs.push(job);
  return jobs;
}

describe("GupyConnector — verificação, consultas e paginação", () => {
  it("verify() consulta a primeira query com limit=1 e aceita lista vazia", async () => {
    emptyResponse = true;
    await expect(makeConnector().verify()).resolves.toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.params.get("jobName")).toBe("estágio");
    expect(requests[0]?.params.get("city")).toBe(CURITIBA);
    expect(requests[0]?.params.get("limit")).toBe("1");
    expect(requests[0]?.params.get("offset")).toBe("0");
  });

  it("pagina até cobrir o total e consulta Curitiba + remoto", async () => {
    const jobs = await collect(makeConnector({ pageSize: 2 }));

    expect(jobs.length).toBe(3);
    const calls = requests.map((r) => ({
      city: r.params.get("city"),
      remote: r.params.get("workplaceType"),
      offset: r.params.get("offset"),
      limit: r.params.get("limit"),
    }));
    expect(calls).toEqual([
      { city: CURITIBA, remote: null, offset: "0", limit: "2" },
      { city: CURITIBA, remote: null, offset: "2", limit: "2" },
      { city: null, remote: REMOTE, offset: "0", limit: "2" },
      { city: null, remote: REMOTE, offset: "2", limit: "2" },
    ]);
  });

  it("não pede a segunda página quando o total cabe na primeira", async () => {
    const jobs = await collect(makeConnector());

    expect(jobs.length).toBe(3);
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.params.get("offset") === "0")).toBe(true);
  });

  it("deduplica entre as consultas", async () => {
    const jobs = await collect(makeConnector());
    const ids = jobs.map((job) => job.externalId);

    expect(ids).toEqual(["101", "102", "201"]);
    expect(ids.filter((id) => id === "101")).toHaveLength(1);
  });

  it("descarta banco de talentos e vaga sem link", async () => {
    const jobs = await collect(makeConnector({ pageSize: 2 }));
    const ids = jobs.map((job) => job.externalId);

    expect(ids).not.toContain("103");
    expect(ids).not.toContain("202");
  });

  it("respeita ctx.maxJobs", async () => {
    const jobs = await collect(makeConnector(), makeContext({ maxJobs: 2 }));
    expect(jobs).toHaveLength(2);
  });

  it("verify() devolve ok:false sem consultas configuradas", async () => {
    const result = await makeConnector({ queries: [] }).verify();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/consulta/i);
    expect(requests).toHaveLength(0);
  });
});

describe("GupyConnector — mapeamento das vagas", () => {
  it("mapeia título, empresa, local, modalidade, tipo, data e descrição", async () => {
    const jobs = await collect(makeConnector());
    const first = jobs.find((job) => job.externalId === "101");

    expect(first).toMatchObject({
      externalId: "101",
      sourceUrl: "https://acme.gupy.io/jobs/101",
      title: "Estágio em Desenvolvimento",
      company: "Acme",
      location: "Curitiba - Paraná",
      workMode: "onsite",
      contractType: "internship",
      postedAt: "2026-11-16T21:42:56.686Z",
    });
    expect(first?.descriptionText).toContain("Java");
    expect(first?.descriptionText).not.toContain("<");
    expect(first?.descriptionText).not.toContain("x()");
    expect(first?.raw).toBeTypeOf("object");
  });

  it("marca híbrido e remoto e mantém data ausente indefinida", async () => {
    const jobs = await collect(makeConnector());
    const hybrid = jobs.find((job) => job.externalId === "102");
    const remote = jobs.find((job) => job.externalId === "201");

    expect(hybrid?.workMode).toBe("hybrid");
    expect(hybrid?.postedAt).toBe("2026-11-15T12:00:00.000Z");
    expect(remote?.workMode).toBe("remote");
    expect(remote?.location).toBeUndefined();
  });
});

describe("GupyConnector — limites e falhas", () => {
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
