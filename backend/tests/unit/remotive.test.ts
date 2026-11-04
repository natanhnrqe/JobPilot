import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { RemotiveConnector } from "../../src/connectors/remotive.js";
import { SourceError, type ConnectorContext } from "../../src/connectors/types.js";

/**
 * Testes OFFLINE com payload fixo: um servidor local serve um JSON idêntico
 * ao formato real verificado em 2026-11-03 (ver docs/FONTES.md). Nenhuma
 * requisição sai da máquina.
 */

/** Payload enxuto no formato real da API Remotive. */
const FIXTURE = {
  "job-count": 3,
  "total-job-count": 1614,
  jobs: [
    {
      id: 2091165,
      url: "https://remotive.com/remote-jobs/software-development/full-stack-developer-2091165",
      title: "Full-Stack Developer",
      company_name: "Fluence International, Inc.",
      category: "Software Development",
      job_type: "contract",
      publication_date: "2026-10-29T18:22:41",
      candidate_required_location: "Worldwide",
      salary: "$3.5k–$5k/month",
      description:
        "<p>Build APIs with <strong>Node.js</strong>.</p><script>alert('x')</script><ul><li>Git</li></ul>",
    },
    {
      id: 2091135,
      url: "https://remotive.com/remote-jobs/software-development/intern-2091135",
      title: "Backend Intern",
      company_name: "Acme Dev",
      category: "Software Development",
      job_type: "internship",
      publication_date: "2026-10-27T12:56:13+00:00",
      candidate_required_location: "Brazil",
      description: "<p>Estágio em backend.</p>",
    },
    {
      id: 999,
      url: "https://remotive.com/remote-jobs/marketing/marketing-999",
      title: "Marketing Lead",
      company_name: "Growth Co",
      category: "Marketing",
      job_type: "full_time",
      publication_date: "2026-10-01T00:00:00",
      candidate_required_location: "Worldwide",
      description: "<p>Marketing.</p>",
    },
  ],
};

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
  return new RemotiveConnector({
    endpoint: `${baseUrl}/api/remote-jobs`,
    fetchOptions: { allowLoopbackForTests: true },
  });
}

describe("RemotiveConnector — verificação e cache", () => {
  it("verify() confirma a API e devolve ok com payload fixo", async () => {
    const result = await makeConnector().verify();
    expect(result).toEqual({ ok: true });
  });

  it("verify() + fetch() compartilham o cache: UMA única requisição", async () => {
    requestCount = 0;
    const connector = makeConnector();

    await connector.verify();
    const jobs = [];
    for await (const job of connector.fetch(makeContext())) jobs.push(job);

    expect(jobs.length).toBeGreaterThan(0);
    expect(requestCount).toBe(1);
  });

  it("verify() devolve ok:false quando a API responde sem lista de vagas", async () => {
    nextResponse = { status: 200, contentType: "application/json", body: '{"erro":true}' };
    try {
      const result = await makeConnector().verify();
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/inesperada/i);
    } finally {
      nextResponse = {
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(FIXTURE),
      };
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
      nextResponse = {
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(FIXTURE),
      };
    }
  });
});

describe("RemotiveConnector — mapeamento das vagas", () => {
  it("mapeia os campos reais da fonte (id externo, empresa, salário, local)", async () => {
    const jobs = [];
    for await (const job of makeConnector().fetch(makeContext())) jobs.push(job);

    const first = jobs[0];
    expect(first).toMatchObject({
      externalId: "2091165",
      sourceUrl:
        "https://remotive.com/remote-jobs/software-development/full-stack-developer-2091165",
      title: "Full-Stack Developer",
      company: "Fluence International, Inc.",
      location: "Worldwide",
      workMode: "remote",
      salaryText: "$3.5k–$5k/month",
      contractType: "unknown", // "contract" não é estágio/freela → não inventa nível
    });
    expect(first.raw).toBeTypeOf("object");
  });

  it("remove o HTML da descrição (sem tags nem scripts)", async () => {
    const jobs = [];
    for await (const job of makeConnector().fetch(makeContext())) jobs.push(job);

    expect(jobs[0].descriptionText).toContain("Build APIs with Node.js");
    expect(jobs[0].descriptionText).toContain("- Git");
    expect(jobs[0].descriptionText).not.toContain("<");
    expect(jobs[0].descriptionText).not.toContain("alert");
  });

  it("só traduz contrato o que a fonte informa (internship sim; full_time não)", async () => {
    // Categoria ampliada para incluir a vaga de Marketing do fixture.
    const connector = new RemotiveConnector({
      endpoint: `${baseUrl}/api/remote-jobs`,
      categories: ["Software Development", "Marketing"],
      fetchOptions: { allowLoopbackForTests: true },
    });
    const jobs = [];
    for await (const job of connector.fetch(makeContext())) jobs.push(job);

    const intern = jobs.find((j) => j.externalId === "2091135");
    expect(intern?.contractType).toBe("internship");
    const marketing = jobs.find((j) => j.externalId === "999");
    expect(marketing?.contractType).toBe("unknown");
  });

  it("normaliza a data de publicação para ISO UTC sem usar a data atual", async () => {
    const jobs = [];
    for await (const job of makeConnector().fetch(makeContext())) jobs.push(job);

    expect(jobs[0].postedAt).toBe("2026-10-29T18:22:41.000Z");
    expect(jobs[1].postedAt).toBe("2026-10-27T12:56:13.000Z");
    // A data vem exclusivamente da fonte — nunca é a data atual.
    expect(jobs[0].postedAt).not.toBe(new Date().toISOString());
  });
});

describe("RemotiveConnector — filtro e limites", () => {
  it("filtra por categoria no cliente (a API ignora ?category=)", async () => {
    const jobs = [];
    for await (const job of makeConnector().fetch(makeContext())) jobs.push(job);

    expect(jobs).toHaveLength(2); // Marketing é excluído pelo filtro padrão
    expect(jobs.every((j) => j.externalId !== "999")).toBe(true);
  });

  it("aceita categorias personalizadas", async () => {
    const connector = new RemotiveConnector({
      endpoint: `${baseUrl}/api/remote-jobs`,
      categories: ["Marketing"],
      fetchOptions: { allowLoopbackForTests: true },
    });
    const jobs = [];
    for await (const job of connector.fetch(makeContext())) jobs.push(job);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Marketing Lead");
  });

  it("respeita ctx.maxJobs", async () => {
    const jobs = [];
    for await (const job of makeConnector().fetch(makeContext({ maxJobs: 1 }))) jobs.push(job);
    expect(jobs).toHaveLength(1);
  });

  it("respeita ctx.signal (aborta a iteração)", async () => {
    const controller = new AbortController();
    controller.abort();
    const jobs = [];
    for await (const job of makeConnector().fetch(makeContext({ signal: controller.signal }))) {
      jobs.push(job);
    }
    expect(jobs).toHaveLength(0);
  });

  it("ignora vaga sem url/título (não persiste lixo)", async () => {
    nextResponse = {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobs: [
          { id: 1, title: "Sem URL" },
          { id: 2, url: "https://x.com/1", title: "  " },
          { id: 3, url: "https://x.com/2", title: "Vaga Boa", category: "Software Development" },
        ],
      }),
    };
    try {
      const jobs = [];
      for await (const job of makeConnector().fetch(makeContext())) jobs.push(job);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].title).toBe("Vaga Boa");
    } finally {
      nextResponse = {
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(FIXTURE),
      };
    }
  });
});
