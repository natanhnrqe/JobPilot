import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { JSearchConnector } from "../../src/connectors/rapidapiJsearch.js";
import { SourceError, type ConnectorContext } from "../../src/connectors/types.js";

/**
 * Testes OFFLINE com payload fixo no formato real verificado em 2026-11-10
 * (ver docs/FONTES.md). Nenhuma requisição sai da máquina.
 */

const CURITIBA = "estágio Curitiba";
const REMOTO = "estágio remoto Brasil";

const FX_CURITIBA = {
  status: "OK",
  data: {
    jobs: [
      {
        job_id: "a1",
        job_title: "Estágio em Marketing",
        employer_name: "ACME",
        job_city: "Curitiba",
        job_state: "PR",
        job_country: "BR",
        job_employment_type: "Estágio",
        job_is_remote: false,
        job_description: "<p>Vaga de <strong>marketing</strong>.</p><script>alert('x')</script>",
        job_apply_link: "https://example.com/a1",
        job_salary_string: "R$ 1.800,00",
        job_posted_at_datetime_utc: "2026-11-06T00:00:00.000Z",
      },
      {
        job_id: "a2",
        job_title: "Estágio em Produção",
        employer_name: "Motherson",
        job_city: "Curitiba",
        job_state: "PR",
        job_employment_type: "Prestador de serviços",
        job_is_remote: false,
        job_description: "<p>Produção.</p>",
        job_apply_link: "https://example.com/a2",
        job_posted_at_datetime_utc: null,
      },
      {
        job_id: "a3",
        job_title: "Estágio em Design",
        employer_name: "SOUZA SANTOS",
        job_city: "Curitiba",
        job_state: "PR",
        job_employment_type: "Meio período",
        job_is_remote: true,
        job_description: "<p>Design.</p>",
        job_google_link: "https://example.com/a3",
      },
      { job_id: "a4", job_title: "", job_apply_link: "https://example.com/a4" },
      { job_id: "a5", job_title: "Estágio sem link" },
      {
        job_id: "a1",
        job_title: "Estágio em Marketing (duplicado)",
        job_apply_link: "https://example.com/a1-duplicado",
      },
    ],
  },
};

const FX_REMOTO = {
  status: "OK",
  data: {
    jobs: [
      {
        job_id: "a1",
        job_title: "Estágio em Marketing",
        job_apply_link: "https://example.com/a1-outra-consulta",
      },
      {
        job_id: "b6",
        job_title: "Estágio Remoto em Dados",
        employer_name: "Remote Co",
        job_city: "São Paulo",
        job_state: "SP",
        job_country: "BR",
        job_employment_type: "Estágio",
        job_is_remote: true,
        job_description: "<p>Dados.</p>",
        job_apply_link: "https://example.com/b6",
      },
    ],
  },
};

const FIXTURES: Record<string, unknown> = {
  [CURITIBA]: FX_CURITIBA,
  [REMOTO]: FX_REMOTO,
};

let server: http.Server;
let baseUrl: string;
let requests: Array<{ query: string; headers: http.IncomingHttpHeaders }> = [];
let failStatus: number | null = null;
let legacyShape = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/search-v2") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"message":"not found"}');
      return;
    }

    const query = url.searchParams.get("query") ?? "";
    requests.push({ query, headers: req.headers });

    if (failStatus !== null) {
      res.writeHead(failStatus, { "Content-Type": "application/json" });
      res.end('{"message":"erro"}');
      return;
    }

    const fixture = FIXTURES[query];
    const body = legacyShape
      ? { status: "OK", data: (fixture as { data: { jobs: unknown[] } }).data.jobs }
      : (fixture ?? { status: "OK", data: { jobs: [] } });
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
  legacyShape = false;
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

function makeConnector(overrides: Partial<ConstructorParameters<typeof JSearchConnector>[0]> = {}) {
  return new JSearchConnector({
    baseUrl,
    apiKey: "chave-de-teste",
    fetchOptions: { allowLoopbackForTests: true },
    ...overrides,
  });
}

async function collect(connector: JSearchConnector, ctx = makeContext()) {
  const jobs = [];
  for await (const job of connector.fetch(ctx)) jobs.push(job);
  return jobs;
}

describe("JSearchConnector — verificação e cache", () => {
  it("verify() confirma a primeira consulta", async () => {
    await expect(makeConnector().verify()).resolves.toEqual({ ok: true });
    expect(requests.map((r) => r.query)).toEqual([CURITIBA]);
  });

  it("verify() + fetch() reaproveitam o cache da primeira consulta", async () => {
    const connector = makeConnector();
    await connector.verify();
    const jobs = await collect(connector);

    expect(jobs.length).toBe(4);
    expect(requests.map((r) => r.query)).toEqual([CURITIBA, REMOTO]);
  });

  it("verify() devolve ok:false quando não há lista de vagas", async () => {
    failStatus = 200;
    // resposta 200 sem `data`: o servidor devolve fixture vazia para consulta desconhecida
    const connector = makeConnector({ queries: ["consulta-vazia"] });
    const result = await connector.verify();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sem vagas|inesperada/i);
  });

  it("verify() devolve ok:false sem consultas configuradas", async () => {
    const result = await makeConnector({ queries: [] }).verify();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/consulta/i);
    expect(requests).toHaveLength(0);
  });

  it("envia os cabeçalhos do RapidAPI sem vazar a chave", async () => {
    await collect(makeConnector());
    const first = requests[0];
    expect(first?.headers["x-rapidapi-key"]).toBe("chave-de-teste");
    expect(first?.headers["x-rapidapi-host"]).toBe("jsearch.p.rapidapi.com");
  });
});

describe("JSearchConnector — mapeamento das vagas", () => {
  it("mapeia título, empresa, local, modalidade, bolsa e descrição", async () => {
    const jobs = await collect(makeConnector());
    const first = jobs.find((job) => job.externalId === "a1");

    expect(first).toMatchObject({
      externalId: "a1",
      sourceUrl: "https://example.com/a1",
      title: "Estágio em Marketing",
      company: "ACME",
      location: "Curitiba - PR",
      workMode: "onsite",
      contractType: "internship",
      salaryText: "R$ 1.800,00",
      postedAt: "2026-11-06T00:00:00.000Z",
    });
    expect(first?.descriptionText).toContain("Vaga de marketing");
    expect(first?.descriptionText).not.toContain("<");
    expect(first?.descriptionText).not.toContain("alert");
    expect(first?.raw).toBeTypeOf("object");
  });

  it("infere estágio pelo título quando o tipo vem localizado", async () => {
    const jobs = await collect(makeConnector());
    const production = jobs.find((job) => job.externalId === "a2");

    expect(production?.contractType).toBe("internship");
    expect(production?.postedAt).toBeUndefined(); // data nula nunca é inventada
  });

  it("usa job_google_link quando não há apply_link e marca remoto", async () => {
    const jobs = await collect(makeConnector());
    const design = jobs.find((job) => job.externalId === "a3");

    expect(design?.sourceUrl).toBe("https://example.com/a3");
    expect(design?.workMode).toBe("remote");
  });

  it("traz a vaga remota da segunda consulta", async () => {
    const jobs = await collect(makeConnector());
    const remote = jobs.find((job) => job.externalId === "b6");

    expect(remote?.workMode).toBe("remote");
    expect(remote?.location).toBe("São Paulo - SP");
  });

  it("aceita o formato antigo data[] ", async () => {
    legacyShape = true;
    const jobs = await collect(makeConnector({ queries: [CURITIBA] }));
    expect(jobs.map((job) => job.externalId)).toContain("a1");
  });
});

describe("JSearchConnector — limites e falhas", () => {
  it("descarta vagas sem título ou sem link e deduplica entre consultas", async () => {
    const jobs = await collect(makeConnector());
    const ids = jobs.map((job) => job.externalId);

    expect(ids).toEqual(["a1", "a2", "a3", "b6"]);
    expect(jobs.some((job) => job.externalId === "a4")).toBe(false);
    expect(jobs.some((job) => job.externalId === "a5")).toBe(false);
    expect(jobs.filter((job) => job.externalId === "a1")).toHaveLength(1);
  });

  it("respeita ctx.maxJobs", async () => {
    const jobs = await collect(makeConnector(), makeContext({ maxJobs: 2 }));
    expect(jobs).toHaveLength(2);
  });

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

  it("recusa chave com CR/LF antes de qualquer requisição", async () => {
    const connector = makeConnector({ apiKey: "chave\r\nX-Evil: 1" });
    await expect(collect(connector)).rejects.toBeInstanceOf(SourceError);
    expect(requests).toHaveLength(0);
  });
});
