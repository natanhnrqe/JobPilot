import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestServer, type AppServer } from "../helpers.js";
import { makeFakeAi, VALID_CV_EXTRACTION, type FakeAiProvider } from "../fakeAi.js";
import { makeDocx, makePdf } from "../fixtures/cvFiles.js";

/**
 * Perfil profissional e importação de CV (migração 005) — API local,
 * banco temporário, provedor de IA falso. Nenhuma rede/chave real.
 */

let server: AppServer;
let cleanup: () => void;
let ai: FakeAiProvider;

beforeEach(() => {
  ai = makeFakeAi({ responses: [VALID_CV_EXTRACTION] });
  const created = makeTestServer({ aiProvider: ai });
  server = created.server;
  cleanup = created.cleanup;
});

afterEach(() => cleanup());

async function previewCv(
  fileName = "curriculo.pdf",
  content = makePdf("Joao Silva - Desenvolvedor Backend - Node.js"),
) {
  return request(server.app)
    .post("/api/v1/profile/cv")
    .send({ fileName, contentBase64: content.toString("base64") });
}

describe("API de perfil profissional", () => {
  it("GET devolve perfil vazio quando nada foi importado", async () => {
    const res = await request(server.app).get("/api/v1/profile");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: 0,
      hasProfile: false,
      rawCvText: null,
      profile: {
        experiences: [],
        education: [],
        skills: [],
        languages: [],
        projects: [],
        inferred: [],
      },
      preferences: {
        desiredRoles: [],
        workModes: [],
        locations: [],
        salaryExpectation: null,
        contractTypes: [],
      },
      answers: {},
    });
    expect(res.body.profile.personal.fullName).toBeNull();
  });

  it("POST /profile/cv devolve prévia e NÃO grava no banco", async () => {
    const res = await previewCv();

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ provider: "fake", model: "fake-model", format: "pdf" });
    expect(res.body.rawText).toContain("Joao Silva");
    expect(res.body.profile.personal.fullName).toEqual({
      value: "Joao Silva",
      sourceQuote: "Joao Silva",
    });
    expect(res.body.profile.experiences[0]).toMatchObject({
      role: "Desenvolvedor Backend",
      start: "2020-03",
      end: "2022-01",
    });
    expect(res.body.profile.projects[0].url).toBe("https://github.com/joao/jobpilot");
    expect(res.body.profile.inferred[0].confirmed).toBe(false);
    expect(res.body.warnings.join(" ")).toContain("precisam da sua confirmação");

    // O texto do CV chegou ao provedor (não o nome do arquivo).
    expect(ai.calls[0]?.user).toContain("Joao Silva");
    expect(ai.calls[0]?.system).toContain("NUNCA invente");

    const count = server.ctx.holder.get().get<{ n: number }>("SELECT COUNT(*) AS n FROM profile");
    expect(count?.n).toBe(0);
  });

  it("extrai DOCX offline e envia o texto correto à IA", async () => {
    const res = await previewCv("curriculo.docx", makeDocx());

    expect(res.status).toBe(200);
    expect(res.body.meta.format).toBe("docx");
    expect(res.body.rawText).toContain("Maria Souza");
    expect(ai.calls[0]?.user).toContain("Maria Souza");
  });

  it("recusa confirmação enquanto houver item inferido não confirmado", async () => {
    const preview = await previewCv();
    const res = await request(server.app)
      .post("/api/v1/profile/cv/confirm")
      .send({ rawCvText: preview.body.rawText, profile: preview.body.profile });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.itens).toHaveLength(1);

    const count = server.ctx.holder.get().get<{ n: number }>("SELECT COUNT(*) AS n FROM profile");
    expect(count?.n).toBe(0);
  });

  it("confirma a versão revisada, persiste e não guarda o arquivo do CV", async () => {
    const preview = await previewCv();
    const profile = preview.body.profile;
    profile.inferred[0].confirmed = true;

    const res = await request(server.app)
      .post("/api/v1/profile/cv/confirm")
      .send({
        rawCvText: preview.body.rawText,
        profile,
        preferences: {
          desiredRoles: ["Desenvolvedor Backend"],
          workModes: ["remote"],
          locations: ["Sao Paulo"],
          salaryExpectation: null,
          contractTypes: ["junior"],
        },
        answers: { "Autorizacao de trabalho": "Sim" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 1, hasProfile: true });
    expect(res.body.rawCvText).toContain("Joao Silva");
    expect(res.body.profile.inferred[0].confirmed).toBe(true);
    expect(res.body.preferences.desiredRoles).toEqual(["Desenvolvedor Backend"]);
    expect(res.body.answers).toEqual({ "Autorizacao de trabalho": "Sim" });

    const row = server.ctx.holder
      .get()
      .get<{ cv_file_path: string | null; raw_cv_text: string }>(
        "SELECT cv_file_path, raw_cv_text FROM profile WHERE id = 1",
      );
    expect(row?.cv_file_path).toBeNull();
    expect(row?.raw_cv_text).toContain("Joao Silva");

    const get = await request(server.app).get("/api/v1/profile");
    expect(get.body.profile.experiences[0].role).toBe("Desenvolvedor Backend");
  });

  it("PUT edita o perfil manualmente, incrementa a versão e preserva o texto do CV", async () => {
    const preview = await previewCv();
    const profile = preview.body.profile;
    profile.inferred[0].confirmed = true;
    await request(server.app)
      .post("/api/v1/profile/cv/confirm")
      .send({ rawCvText: preview.body.rawText, profile });

    const edited = { ...profile, personal: { ...profile.personal } };
    edited.personal.fullName = {
      value: "Joao P. Silva",
      sourceQuote: profile.personal.fullName.sourceQuote,
    };

    const res = await request(server.app).put("/api/v1/profile").send({ profile: edited });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.profile.personal.fullName.value).toBe("Joao P. Silva");
    expect(res.body.rawCvText).toContain("Joao Silva");
  });

  it("rejeita PUT vazio", async () => {
    const res = await request(server.app).put("/api/v1/profile").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejeita formato de arquivo não suportado", async () => {
    const res = await request(server.app)
      .post("/api/v1/profile/cv")
      .send({
        fileName: "curriculo.rtf",
        contentBase64: Buffer.from("{\\rtf1}").toString("base64"),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejeita base64 malformado", async () => {
    const res = await request(server.app)
      .post("/api/v1/profile/cv")
      .send({ fileName: "curriculo.pdf", contentBase64: "nao-e-base64!" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("devolve 503 quando a IA não está configurada", async () => {
    const created = makeTestServer();
    try {
      const res = await request(created.server.app)
        .post("/api/v1/profile/cv")
        .send({
          fileName: "curriculo.pdf",
          contentBase64: makePdf("Joao Silva - Desenvolvedor Backend").toString("base64"),
        });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("AI_UNAVAILABLE");
    } finally {
      created.cleanup();
    }
  });

  it("devolve 502 quando a IA não produz JSON válido após a retentativa", async () => {
    const invalidAi = makeFakeAi({ responses: ["isto nao e json", "isto nao e json"] });
    const created = makeTestServer({ aiProvider: invalidAi });
    try {
      const res = await request(created.server.app)
        .post("/api/v1/profile/cv")
        .send({
          fileName: "curriculo.pdf",
          contentBase64: makePdf("Joao Silva - Desenvolvedor Backend").toString("base64"),
        });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe("AI_INVALID_RESPONSE");
      expect(invalidAi.calls).toHaveLength(2);
    } finally {
      created.cleanup();
    }
  });
});
