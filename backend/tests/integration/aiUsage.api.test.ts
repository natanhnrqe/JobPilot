import { describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestServer, type AppServer } from "../helpers.js";
import {
  makeFakeAi,
  VALID_CV_EXTRACTION,
  VALID_EXTRACTION,
  VALID_JOB_ANALYSIS,
  VALID_JOB_ANALYSIS_2,
} from "../fakeAi.js";
import { emptyProfile, emptyProfilePreferences } from "../../src/domain/profile.js";
import { saveProfile } from "../../src/repositories/profile.js";
import { createJob } from "../../src/services/jobs.js";
import { makePdf } from "../fixtures/cvFiles.js";

/**
 * Orçamento diário de IA (migração 007 / tarefa 3.4) — banco temporário e
 * provedor falso. Nenhuma rede/chave real.
 */

const JOB_DESCRIPTION =
  "Vaga 100% remota para desenvolvedor backend. Requisitos: Node.js e 3 anos de experiencia.";

function seedProfile(server: AppServer): void {
  const profile = emptyProfile();
  profile.personal.fullName = { value: "Joao Silva", sourceQuote: "Joao Silva" };
  profile.skills = [{ name: "Node.js", level: "advanced", sourceQuote: "Node.js avancado" }];
  saveProfile(server.ctx.holder.get(), {
    profile,
    preferences: emptyProfilePreferences(),
    answers: {},
  });
}

function createJobFor(server: AppServer) {
  return createJob(server.ctx, {
    title: "Desenvolvedor Backend Junior",
    descriptionText: JOB_DESCRIPTION,
  });
}

describe("Orçamento diário de IA", () => {
  it("registra o consumo, atinge o teto e bloqueia a próxima chamada antes de gastar", async () => {
    const ai = makeFakeAi({
      responses: [VALID_JOB_ANALYSIS, VALID_JOB_ANALYSIS_2],
      tokensIn: 60,
      tokensOut: 40,
    });
    const created = makeTestServer({ aiProvider: ai, env: { AI_DAILY_BUDGET: "100" } });
    try {
      const { server } = created;
      seedProfile(server);
      const job = createJobFor(server);

      const first = await request(server.app).post(`/api/v1/jobs/${job.id}/analysis`);
      expect(first.status).toBe(201);

      const usage = await request(server.app).get("/api/v1/ai/usage");
      expect(usage.status).toBe(200);
      expect(usage.body).toMatchObject({
        budgetTokens: 100,
        totalTokens: 100,
        remainingTokens: 0,
        exceeded: true,
        calls: 1,
        tokensIn: 60,
        tokensOut: 40,
      });
      expect(usage.body.byKind.analysis).toMatchObject({ calls: 1, totalTokens: 100 });

      const second = await request(server.app).post(`/api/v1/jobs/${job.id}/analysis`);
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe("AI_BUDGET_EXCEEDED");
      expect(second.body.error.message).toContain("Teto diário");
      expect(second.body.error.details).toMatchObject({
        usedTokens: 100,
        budgetTokens: 100,
      });

      // A chamada bloqueada não chegou ao provedor nem criou nova versão.
      expect(ai.calls).toHaveLength(1);
      const db = server.ctx.holder.get();
      const analyses = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_analyses");
      expect(analyses?.n).toBe(1);

      // Aviso registrado em execution_logs (nível warn), mesmo sem run associada.
      const warn = db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM execution_logs WHERE step = 'ai.budget.exceeded' AND level = 'warn'",
      );
      expect(warn?.n).toBe(1);

      const status = await request(server.app).get("/api/v1/extractions/status");
      expect(status.body.dailyBudgetTokens).toBe(100);
    } finally {
      created.cleanup();
    }
  });

  it("teto 0 significa sem limite e continua registrando o uso", async () => {
    const ai = makeFakeAi({
      responses: [VALID_JOB_ANALYSIS, VALID_JOB_ANALYSIS_2],
      tokensIn: 10,
      tokensOut: 5,
    });
    const created = makeTestServer({ aiProvider: ai });
    try {
      const { server } = created;
      seedProfile(server);
      const job = createJobFor(server);

      expect((await request(server.app).post(`/api/v1/jobs/${job.id}/analysis`)).status).toBe(201);
      expect((await request(server.app).post(`/api/v1/jobs/${job.id}/analysis`)).status).toBe(201);

      const usage = await request(server.app).get("/api/v1/ai/usage");
      expect(usage.body).toMatchObject({
        budgetTokens: 0,
        totalTokens: 30,
        remainingTokens: null,
        exceeded: false,
        calls: 2,
      });
      expect(ai.calls).toHaveLength(2);
    } finally {
      created.cleanup();
    }
  });

  it("conta a extração assistida de vaga no uso do dia", async () => {
    const ai = makeFakeAi({ responses: [VALID_EXTRACTION] });
    const created = makeTestServer({ aiProvider: ai });
    try {
      const { server } = created;
      const res = await request(server.app)
        .post("/api/v1/extractions/from-text")
        .send({ text: "Estágio em desenvolvimento backend com Node.js e SQL. ".repeat(3) });
      expect(res.status).toBe(200);

      const usage = await request(server.app).get("/api/v1/ai/usage");
      expect(usage.body.byKind.extraction.calls).toBe(1);
      expect(usage.body.byKind.extraction.totalTokens).toBeGreaterThan(0);
      expect(usage.body.byKind.analysis.calls).toBe(0);
    } finally {
      created.cleanup();
    }
  });

  it("conta a importação de currículo no uso do dia", async () => {
    const ai = makeFakeAi({ responses: [VALID_CV_EXTRACTION] });
    const created = makeTestServer({ aiProvider: ai });
    try {
      const { server } = created;
      const res = await request(server.app)
        .post("/api/v1/profile/cv")
        .send({
          fileName: "curriculo.pdf",
          contentBase64: makePdf("Joao Silva - Desenvolvedor Backend - Node.js").toString("base64"),
        });
      expect(res.status).toBe(200);

      const usage = await request(server.app).get("/api/v1/ai/usage");
      expect(usage.body.byKind.cv.calls).toBe(1);
      expect(usage.body.byKind.cv.totalTokens).toBeGreaterThan(0);
    } finally {
      created.cleanup();
    }
  });

  it("marca como estimado quando o provedor não informa os tokens", async () => {
    const ai = makeFakeAi({ responses: [VALID_JOB_ANALYSIS] });
    const created = makeTestServer({ aiProvider: ai });
    try {
      const { server } = created;
      seedProfile(server);
      const job = createJobFor(server);

      expect((await request(server.app).post(`/api/v1/jobs/${job.id}/analysis`)).status).toBe(201);

      const usage = await request(server.app).get("/api/v1/ai/usage");
      expect(usage.body.estimatedCalls).toBe(1);
      expect(usage.body.byKind.analysis.estimatedCalls).toBe(1);
      expect(usage.body.totalTokens).toBeGreaterThan(0);
    } finally {
      created.cleanup();
    }
  });
});
