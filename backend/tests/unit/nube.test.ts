import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NubeConnector } from "../../src/connectors/nube.js";
import { SourceError, type ConnectorContext } from "../../src/connectors/types.js";

/**
 * Testes OFFLINE com payload fixo no formato real verificado em 2026-11-10
 * (ver docs/FONTES.md). O servidor local imita a listagem paginada e o
 * detalhe com JSON-LD; nenhuma requisição sai da máquina.
 */

const TOTAL = 6;

function view(overrides: Record<string, unknown>) {
  return {
    id_vaga: 1,
    titulo: "Marketing - 1",
    cidade: "Curitiba",
    uf: "PR",
    bolsa_valor: "R$ 1.800,00",
    selo: [],
    url: "/detalhes-vaga/1/vaga-de-estagio-em-marketing-curitiba-pr",
    id_modalidade_atuacao: 1,
    ...overrides,
  };
}

function page(ids: number[], views: Record<string, unknown>[]) {
  return {
    param: {
      lista_ids_vaga: ids,
      offset: { total: TOTAL, mostra_btn_mais: 1 },
      dict_por_id_vaga: Object.fromEntries(
        views.map((item) => [String((item as { id_vaga: number }).id_vaga), { view: item }]),
      ),
    },
  };
}

const PAGES: Record<number, unknown> = {
  0: page(
    [1, 2],
    [
      view({ id_vaga: 1 }),
      view({
        id_vaga: 2,
        titulo: "Vendas - 2",
        cidade: "São Paulo",
        uf: "SP",
        bolsa_valor: "R$ 2.000,00",
        url: "/detalhes-vaga/2/vaga-de-estagio-em-vendas-sao-paulo-sp",
      }),
    ],
  ),
  2: page(
    [3, 4],
    [
      view({
        id_vaga: 3,
        titulo: "Tecnologia da Informação - 3",
        bolsa_valor: "R$ 1.500,00",
        selo: ["hibrido"],
        url: "/detalhes-vaga/3/vaga-de-estagio-em-ti-curitiba-pr",
      }),
      view({
        id_vaga: 4,
        titulo: "Finanças - 4",
        cidade: "Barueri",
        uf: "SP",
        bolsa_valor: "R$ 1.709,00",
        selo: ["home_office"],
        id_modalidade_atuacao: 2,
        url: "/detalhes-vaga/4/vaga-de-estagio-em-financas-barueri-sp",
      }),
    ],
  ),
  4: page(
    [5, 1, 6],
    [
      view({
        id_vaga: 5,
        titulo: "Administrativa - 5",
        bolsa_valor: "R$ 1.000,00",
        url: "/detalhes-vaga/5/vaga-de-estagio-em-administrativa-curitiba-pr",
      }),
      view({ id_vaga: 1 }),
      view({ id_vaga: 6, titulo: "Sem URL - 6", url: undefined }),
    ],
  ),
};

function ld(overrides: Record<string, unknown>) {
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Marketing",
    datePosted: "2026-11-06",
    validThrough: "2026-12-06 00:00:00",
    employmentType: "INTERN",
    hiringOrganization: { name: "Nube - Estagiários e Aprendizes" },
    jobLocation: { address: { addressLocality: "Curitiba", addressRegion: "PR" } },
    baseSalary: { currency: "BRL", value: { value: 1800 } },
    description: "<p>Atuar com <strong>marketing</strong>.</p><script>alert('x')</script>",
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown>) {
  return {
    param: {
      _jobposting_sch: `<script type="application/ld+json">${JSON.stringify(ld(overrides))}</script>`,
      vaga_home_office: false,
      vaga_hibrida: false,
      texto_tipo_vaga: "Vaga de Estágio",
      texto_valor_ba: "R$ 1.800,00",
    },
  };
}

const DETAILS: Record<string, unknown> = {
  1: detail({}),
  3: detail({
    title: "Tecnologia da Informação",
    datePosted: "2026-11-04",
    validThrough: "2026-12-04 00:00:00",
    hiringOrganization: { name: "Saber" },
    description: "<p>Suporte e redes.</p>",
    baseSalary: { currency: "BRL", value: { value: 1500 } },
  }),
  4: detail({
    title: "Finanças",
    datePosted: "2026-11-10",
    validThrough: "2026-12-10 00:00:00",
    description: "<p>Rotinas financeiras.</p>",
    baseSalary: { currency: "BRL", value: { value: 1709 } },
  }),
  5: detail({
    title: "Administrativa",
    datePosted: "2026-01-01",
    validThrough: "2020-01-01 00:00:00",
    description: "<p>Vaga antiga.</p>",
  }),
};

let server: http.Server;
let baseUrl: string;
let listStatus = 200;
let listRequests: number[] = [];
let detailRequests: string[] = [];
let detailFailIds = new Set<string>();
let page0Override: unknown = null;
let failListAtOffset: number | null = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/api/portal/buscar_filtro_vagas") {
      const offset = Number(url.searchParams.get("offset") ?? "0");
      listRequests.push(offset);
      res.writeHead(listStatus, { "Content-Type": "application/json; charset=utf-8" });
      if (listStatus !== 200 || failListAtOffset === offset) {
        res.end('{"erro":true}');
        return;
      }
      const body = offset === 0 && page0Override ? page0Override : (PAGES[offset] ?? page([], []));
      res.end(JSON.stringify(body));
      return;
    }

    if (url.pathname === "/api/portal/buscar-detalhes-vaga/json") {
      const id = url.searchParams.get("id_vaga") ?? "";
      detailRequests.push(id);
      if (detailFailIds.has(id)) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end('{"erro":true}');
        return;
      }
      const body = DETAILS[id];
      if (!body) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"erro":true}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  listStatus = 200;
  listRequests = [];
  detailRequests = [];
  detailFailIds = new Set();
  page0Override = null;
  failListAtOffset = null;
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

function makeConnector(overrides: { detailDelayMs?: number; pageSize?: number } = {}) {
  return new NubeConnector({
    baseUrl,
    pageSize: overrides.pageSize ?? 2,
    detailDelayMs: overrides.detailDelayMs ?? 0,
    now: () => new Date("2026-11-10T12:00:00"),
    fetchOptions: { allowLoopbackForTests: true },
  });
}

async function collect(connector: NubeConnector, ctx = makeContext()) {
  const jobs = [];
  for await (const job of connector.fetch(ctx)) jobs.push(job);
  return jobs;
}

describe("NubeConnector — verificação e cache", () => {
  it("verify() confirma a listagem e o total", async () => {
    await expect(makeConnector().verify()).resolves.toEqual({ ok: true });
    expect(listRequests).toEqual([0]);
  });

  it("verify() devolve ok:false quando falta a lista de vagas", async () => {
    page0Override = { param: { offset: { total: 6 } } };
    const result = await makeConnector().verify();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/lista de vagas/i);
  });

  it("verify() devolve ok:false quando falta o total", async () => {
    page0Override = { param: { lista_ids_vaga: [1] } };
    const result = await makeConnector().verify();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/total/i);
  });

  it("verify() + fetch() reaproveitam a primeira página do cache", async () => {
    const connector = makeConnector();
    await connector.verify();
    const jobs = await collect(connector);

    expect(jobs.length).toBeGreaterThan(0);
    // Páginas 0, 2 e 4 — a página 0 não é baixada duas vezes.
    expect(listRequests).toEqual([0, 2, 4]);
  });

  it("fetch() propaga SourceError quando a listagem responde 429", async () => {
    listStatus = 429;
    await expect(collect(makeConnector())).rejects.toBeInstanceOf(SourceError);
  });
});

describe("NubeConnector — mapeamento das vagas", () => {
  it("mapeia título, local, bolsa, descrição e data do JSON-LD", async () => {
    const jobs = await collect(makeConnector());
    const first = jobs.find((job) => job.externalId === "1");

    expect(first).toMatchObject({
      externalId: "1",
      sourceUrl: "https://www.nube.com.br/detalhes-vaga/1/vaga-de-estagio-em-marketing-curitiba-pr",
      title: "Marketing",
      location: "Curitiba - PR",
      workMode: "onsite",
      contractType: "internship",
      salaryText: "R$ 1.800,00",
      postedAt: "2026-11-06T00:00:00.000Z",
    });
    expect(first?.company).toBeUndefined(); // a Nube é a agente, não a empregadora
    expect(first?.descriptionText).toContain("Atuar com marketing");
    expect(first?.descriptionText).not.toContain("<");
    expect(first?.descriptionText).not.toContain("alert");
    expect(first?.raw).toBeTypeOf("object");
  });

  it("revela a empresa real quando o JSON-LD não é a Nube", async () => {
    const jobs = await collect(makeConnector());
    const hybrid = jobs.find((job) => job.externalId === "3");

    expect(hybrid?.company).toBe("Saber");
    expect(hybrid?.workMode).toBe("hybrid");
    expect(hybrid?.title).toBe("Tecnologia da Informação");
  });

  it("marca home office como remoto e mantém a cidade de origem", async () => {
    const jobs = await collect(makeConnector());
    const remote = jobs.find((job) => job.externalId === "4");

    expect(remote?.workMode).toBe("remote");
    expect(remote?.location).toBe("Barueri - SP");
  });

  it("remove o sufixo de ID do título quando o detalhe não tem título", async () => {
    detailFailIds.add("1");
    const jobs = await collect(makeConnector());
    const first = jobs.find((job) => job.externalId === "1");

    expect(first?.title).toBe("Marketing");
  });
});

describe("NubeConnector — filtro local e limites", () => {
  it("mantém Curitiba/Grande Curitiba e home office; descarta outras cidades", async () => {
    const jobs = await collect(makeConnector());
    const ids = jobs.map((job) => job.externalId);

    expect(ids).toEqual(["1", "3", "4"]);
    expect(detailRequests).not.toContain("2"); // São Paulo presencial nem busca detalhe
  });

  it("descarta vaga vencida pelo validThrough", async () => {
    const jobs = await collect(makeConnector());
    expect(jobs.some((job) => job.externalId === "5")).toBe(false);
  });

  it("deduplica IDs repetidos entre páginas e busca o detalhe uma única vez", async () => {
    const jobs = await collect(makeConnector());
    expect(jobs.filter((job) => job.externalId === "1")).toHaveLength(1);
    expect(detailRequests.filter((id) => id === "1")).toHaveLength(1);
  });

  it("respeita ctx.maxJobs (sem buscar detalhe além do limite)", async () => {
    const jobs = await collect(makeConnector(), makeContext({ maxJobs: 1 }));
    expect(jobs).toHaveLength(1);
    expect(detailRequests).toHaveLength(1);
  });

  it("respeita ctx.signal já abortado (sem requisições)", async () => {
    const controller = new AbortController();
    controller.abort();
    const jobs = await collect(makeConnector(), makeContext({ signal: controller.signal }));

    expect(jobs).toHaveLength(0);
    expect(listRequests).toHaveLength(0);
  });
});

describe("NubeConnector — falhas parciais", () => {
  it("usa os dados da listagem quando o detalhe falha", async () => {
    detailFailIds.add("1");
    const jobs = await collect(makeConnector());
    const first = jobs.find((job) => job.externalId === "1");

    expect(first).toBeDefined();
    expect(first?.descriptionText).toContain("Vaga de estágio em Marketing");
    expect(first?.postedAt).toBeUndefined(); // não inventa data
  });

  it("segue com as páginas já lidas quando uma página posterior falha", async () => {
    failListAtOffset = 4;
    const jobs = await collect(makeConnector());
    expect(jobs.map((job) => job.externalId)).toEqual(["1", "3", "4"]);
    expect(listRequests).toEqual([0, 2, 4]);
  });
});
