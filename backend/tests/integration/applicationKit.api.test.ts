import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestServer, type AppServer } from "../helpers.js";
import { makeFakeAi, VALID_JOB_ANALYSIS } from "../fakeAi.js";
import { emptyProfile, emptyProfilePreferences } from "../../src/domain/profile.js";
import { saveProfile } from "../../src/repositories/profile.js";

/**
 * Candidatura assistida (Fase 4, fatia 1): kit de dados + envio declarado.
 * Banco temporário e provedor de IA falso — nenhuma rede/chave real.
 */

let server: AppServer;
let cleanup: () => void;

const JOB_DESCRIPTION =
  "Vaga 100% remota para desenvolvedor backend. Requisitos: Node.js e 3 anos de experiencia.";

const ANALYSIS_WITH_MISSING = JSON.stringify({
  ...JSON.parse(VALID_JOB_ANALYSIS),
  requirements: [
    { text: "Node.js", kind: "required", match: "matched" },
    { text: "Kubernetes", kind: "required", match: "missing" },
    { text: "Ingles fluente", kind: "nice_to_have", match: "unknown" },
  ],
});

beforeEach(() => {
  const created = makeTestServer({ aiProvider: makeFakeAi({ responses: [VALID_JOB_ANALYSIS] }) });
  server = created.server;
  cleanup = created.cleanup;
});

afterEach(() => cleanup());

function seedProfile(target: AppServer = server): void {
  const profile = emptyProfile();
  profile.personal.fullName = { value: "Joao Silva", sourceQuote: "Joao Silva" };
  profile.personal.email = { value: "joao@example.com", sourceQuote: "joao@example.com" };
  profile.personal.phone = { value: "+55 11 99999-0000", sourceQuote: "+55 11 99999-0000" };
  profile.personal.linkedinUrl = {
    value: "https://linkedin.com/in/joao",
    sourceQuote: "linkedin.com/in/joao",
  };
  profile.personal.summary = {
    value: "Desenvolvedor backend com foco em Node.js",
    sourceQuote: "Desenvolvedor backend com foco em Node.js",
  };
  profile.experiences = [
    {
      role: "Desenvolvedor Backend",
      company: "Acme",
      start: "2020-03",
      end: null,
      current: true,
      highlights: ["APIs em Node.js"],
      sourceQuote: "Desenvolvedor Backend na Acme",
    },
  ];
  profile.skills = [{ name: "Node.js", level: "advanced", sourceQuote: "Node.js avancado" }];
  profile.languages = [{ name: "Ingles", level: "intermediario", sourceQuote: "Ingles" }];

  saveProfile(target.ctx.holder.get(), {
    profile,
    preferences: emptyProfilePreferences(),
    answers: { "Pretensão salarial": "R$ 6.000" },
  });
}

async function createJobViaApi(overrides: Record<string, unknown> = {}) {
  return request(server.app)
    .post("/api/v1/jobs")
    .send({
      title: "Desenvolvedor Backend Junior",
      company: "Acme",
      descriptionText: JOB_DESCRIPTION,
      sourceUrl: "https://portal.gupy.io/job/123",
      ...overrides,
    });
}

function checklistOf(body: { checklist: Array<{ id: string; status: string }> }) {
  return Object.fromEntries(body.checklist.map((item) => [item.id, item.status]));
}

describe("Kit de candidatura assistida", () => {
  it("monta o kit com portal, perfil, respostas e checklist sem criar candidatura", async () => {
    seedProfile();
    const job = await createJobViaApi();

    const res = await request(server.app).get(`/api/v1/jobs/${job.body.id}/application-kit`);

    expect(res.status).toBe(200);
    expect(res.body.portal).toMatchObject({ key: "gupy", label: "Gupy", manualOnly: true });
    expect(res.body.job.sourceUrl).toBe("https://portal.gupy.io/job/123");
    expect(res.body.profile.personal).toMatchObject({
      fullName: "Joao Silva",
      email: "joao@example.com",
      phone: "+55 11 99999-0000",
    });
    expect(res.body.profile.skills).toEqual(["Node.js"]);
    expect(res.body.answers).toEqual([{ key: "Pretensão salarial", value: "R$ 6.000" }]);
    expect(res.body.fit).toBeNull();

    expect(checklistOf(res.body)).toMatchObject({
      profile: "ok",
      contact: "ok",
      links: "ok",
      sourceUrl: "ok",
      description: "ok",
      analysis: "warn",
      jobStatus: "ok",
    });

    // O kit é somente leitura: nenhuma candidatura foi criada.
    const detail = await request(server.app).get(`/api/v1/jobs/${job.body.id}`);
    expect(detail.body.application).toBeNull();
  });

  it("inclui a última análise com score, lacunas e requisitos obrigatórios não atendidos", async () => {
    seedProfile();
    const job = await createJobViaApi();
    await request(server.app).post(`/api/v1/jobs/${job.body.id}/analysis`);

    const res = await request(server.app).get(`/api/v1/jobs/${job.body.id}/application-kit`);

    expect(res.body.fit).toMatchObject({
      version: 1,
      score: 82,
      recommendApply: true,
      confidence: "high",
      missingRequired: [],
    });
    expect(res.body.fit.gaps).toHaveLength(1);
    expect(checklistOf(res.body).analysis).toBe("ok");
  });

  it("lista como pendência o requisito obrigatório que o perfil não atende", async () => {
    const created = makeTestServer({
      aiProvider: makeFakeAi({ responses: [ANALYSIS_WITH_MISSING] }),
    });
    try {
      seedProfile(created.server);
      const job = await request(created.server.app).post("/api/v1/jobs").send({
        title: "Dev Backend",
        descriptionText: JOB_DESCRIPTION,
        sourceUrl: "https://www.linkedin.com/jobs/view/1",
      });

      await request(created.server.app).post(`/api/v1/jobs/${job.body.id}/analysis`);
      const kit = await request(created.server.app).get(
        `/api/v1/jobs/${job.body.id}/application-kit`,
      );

      expect(kit.body.portal.key).toBe("linkedin");
      expect(kit.body.fit.missingRequired).toEqual(["Kubernetes"]);
    } finally {
      created.cleanup();
    }
  });

  it("vaga inexistente retorna 404", async () => {
    const res = await request(server.app).get("/api/v1/jobs/99999/application-kit");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("Envio declarado pelo usuário", () => {
  it("cria a candidatura, grava a data e registra o evento", async () => {
    const job = await createJobViaApi();

    const res = await request(server.app)
      .post(`/api/v1/jobs/${job.body.id}/application/mark-sent`)
      .send({ appliedAt: "2026-11-01" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("sent");
    expect(res.body.appliedAt).toMatch(/^2026-11-01/);

    const detail = await request(server.app).get(`/api/v1/jobs/${job.body.id}`);
    expect(detail.body.application).toMatchObject({ status: "sent" });
    expect(
      detail.body.events.some(
        (event: { type: string; message: string | null }) =>
          event.type === "application.status_changed" &&
          event.message === "Envio declarado pelo usuário",
      ),
    ).toBe(true);
  });

  it("é idempotente: confirmar duas vezes não cria outra candidatura", async () => {
    const job = await createJobViaApi();

    const first = await request(server.app).post(
      `/api/v1/jobs/${job.body.id}/application/mark-sent`,
    );
    const second = await request(server.app).post(
      `/api/v1/jobs/${job.body.id}/application/mark-sent`,
    );

    expect(first.body.id).toBe(second.body.id);
    expect(second.body.status).toBe("sent");
    const count = server.ctx.holder
      .get()
      .get<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE job_id = ?", [job.body.id]);
    expect(count?.n).toBe(1);
  });

  it("marca como enviada uma candidatura que já estava em preparação", async () => {
    const job = await createJobViaApi();
    const created = await request(server.app).post(`/api/v1/jobs/${job.body.id}/application`);
    expect(created.body.status).toBe("preparing");

    const res = await request(server.app).post(`/api/v1/jobs/${job.body.id}/application/mark-sent`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.status).toBe("sent");
    expect(res.body.appliedAt).toBeTruthy();
  });
});
