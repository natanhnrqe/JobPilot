import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestServer, type AppServer } from "../helpers.js";
import { makeFakeAi, VALID_APPLICATION_DRAFT } from "../fakeAi.js";
import { emptyProfile, emptyProfilePreferences } from "../../src/domain/profile.js";
import { saveProfile } from "../../src/repositories/profile.js";

/**
 * Rascunho de candidatura com IA (Fase 4, fatia 3).
 *
 * Provedor falso e banco temporário: nenhuma rede, nenhuma chave real. O
 * rascunho não cria candidatura e não envia nada.
 */

let server: AppServer;
let cleanup: () => void;

const JOB_DESCRIPTION =
  "Vaga 100% remota para desenvolvedor backend. Requisitos: Node.js e 3 anos de experiencia.";

beforeEach(() => {
  const created = makeTestServer({
    aiProvider: makeFakeAi({ responses: [VALID_APPLICATION_DRAFT] }),
  });
  server = created.server;
  cleanup = created.cleanup;
});

afterEach(() => cleanup());

function seedProfile(target: AppServer = server): void {
  const profile = emptyProfile();
  profile.personal.fullName = { value: "Joao Silva", sourceQuote: "Joao Silva" };
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

  saveProfile(target.ctx.holder.get(), {
    profile,
    preferences: emptyProfilePreferences(),
    answers: {},
  });
}

async function createJob(target: AppServer = server) {
  return request(target.app).post("/api/v1/jobs").send({
    title: "Desenvolvedor Backend Junior",
    company: "Acme",
    descriptionText: JOB_DESCRIPTION,
    sourceUrl: "https://portal.gupy.io/job/123",
  });
}

describe("Rascunho de candidatura com IA", () => {
  it("gera carta e respostas com citações verificadas, sem criar candidatura", async () => {
    seedProfile();
    const job = await createJob();

    const res = await request(server.app)
      .post(`/api/v1/jobs/${job.body.id}/application-draft`)
      .send({ questions: ["Por que você quer trabalhar nesta empresa?"] });

    expect(res.status).toBe(201);
    expect(res.body.promptVersion).toBe("application-draft-v1");
    expect(res.body.model).toBe("fake-model");
    expect(res.body.coverLetter).toHaveLength(2);
    expect(res.body.coverLetterText).toContain("Desenvolvedor Backend");
    expect(res.body.answers).toHaveLength(1);
    expect(res.body.answers[0].evidence.length).toBeGreaterThan(0);
    expect(res.body.warnings).toContain(
      "A vaga pede 3 anos de experiencia; o perfil nao informa o total.",
    );

    // Nada é enviado nem vira candidatura.
    const detail = await request(server.app).get(`/api/v1/jobs/${job.body.id}`);
    expect(detail.body.application).toBeNull();

    // O rascunho conta no orçamento de IA com o tipo "draft".
    const usage = await request(server.app).get("/api/v1/ai/usage");
    expect(usage.body.byKind.draft.calls).toBe(1);
    expect(usage.body.byKind.draft.totalTokens).toBeGreaterThan(0);

    // Fica registrado no histórico de eventos da vaga.
    expect(
      detail.body.events.some(
        (event: { type: string }) => event.type === "job.application_draft_generated",
      ),
    ).toBe(true);
  });

  it("sem perguntas, devolve apenas a carta", async () => {
    seedProfile();
    const job = await createJob();

    const res = await request(server.app)
      .post(`/api/v1/jobs/${job.body.id}/application-draft`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.coverLetter.length).toBeGreaterThan(0);
    expect(res.body.answers).toEqual([]);
  });

  it("recusa quando o perfil não tem dados profissionais", async () => {
    const job = await createJob();

    const res = await request(server.app).post(`/api/v1/jobs/${job.body.id}/application-draft`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/perfil/i);
  });

  it("recusa vaga sem descrição suficiente", async () => {
    seedProfile();
    const job = await request(server.app)
      .post("/api/v1/jobs")
      .send({ title: "Dev", descriptionText: "Curta." });

    const res = await request(server.app).post(`/api/v1/jobs/${job.body.id}/application-draft`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/descrição suficiente/i);
  });

  it("recusa mais de 10 perguntas", async () => {
    seedProfile();
    const job = await createJob();
    const questions = Array.from({ length: 11 }, (_, index) => `Pergunta ${index + 1}?`);

    const res = await request(server.app)
      .post(`/api/v1/jobs/${job.body.id}/application-draft`)
      .send({ questions });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("vaga inexistente retorna 404", async () => {
    const res = await request(server.app).post("/api/v1/jobs/99999/application-draft");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("sem chave de IA, retorna 503 e não grava nada", async () => {
    const created = makeTestServer();
    try {
      seedProfile(created.server);
      const job = await createJob(created.server);

      const res = await request(created.server.app).post(
        `/api/v1/jobs/${job.body.id}/application-draft`,
      );

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("AI_UNAVAILABLE");
    } finally {
      created.cleanup();
    }
  });

  it("respeita o teto diário de IA", async () => {
    const created = makeTestServer({
      aiProvider: makeFakeAi({ responses: [VALID_APPLICATION_DRAFT] }),
      env: { AI_DAILY_BUDGET: "1" },
    });
    try {
      seedProfile(created.server);
      const job = await createJob(created.server);

      const first = await request(created.server.app).post(
        `/api/v1/jobs/${job.body.id}/application-draft`,
      );
      expect(first.status).toBe(201);

      const second = await request(created.server.app).post(
        `/api/v1/jobs/${job.body.id}/application-draft`,
      );
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe("AI_BUDGET_EXCEEDED");
    } finally {
      created.cleanup();
    }
  });
});
