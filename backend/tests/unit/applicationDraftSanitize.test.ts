import { describe, expect, it } from "vitest";
import { sanitizeApplicationDraft, type DraftAiInput } from "../../src/domain/applicationDraft.js";

const corpus = {
  cv: JSON.stringify({
    personal: { summary: "Desenvolvedor backend com foco em Node.js" },
    experiences: [{ role: "Desenvolvedor Backend", company: "Acme" }],
    skills: [{ name: "Node.js", level: "advanced" }],
  }),
  job: JSON.stringify({
    title: "Desenvolvedor Backend Junior",
    description: "Vaga 100% remota. Requisitos: Node.js e 3 anos de experiencia.",
  }),
};

function draft(overrides: Partial<DraftAiInput> = {}): DraftAiInput {
  return {
    cover_letter: [
      {
        text: "Sou desenvolvedor backend com foco em Node.js.",
        evidence: [{ source: "cv", quote: "Desenvolvedor backend com foco em Node.js" }],
      },
    ],
    answers: [],
    warnings: [],
    ...overrides,
  };
}

describe("sanitizeApplicationDraft", () => {
  it("mantém citações literais do perfil e da vaga, ignorando acentos e caixa", () => {
    const result = sanitizeApplicationDraft(
      draft({
        cover_letter: [
          {
            text: "Atuo como Desenvolvedor Backend e a vaga é 100% remota.",
            evidence: [
              { source: "cv", quote: "desenvolvedor backend" },
              { source: "job", quote: "vaga 100% remota" },
            ],
          },
        ],
      }),
      corpus,
    );

    expect(result.coverLetter).toHaveLength(1);
    expect(result.coverLetter[0]!.evidence).toEqual([
      { source: "cv", quote: "desenvolvedor backend" },
      { source: "job", quote: "vaga 100% remota" },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("remove trecho sem citação verificável e registra aviso", () => {
    const result = sanitizeApplicationDraft(
      draft({
        cover_letter: [
          {
            text: "Tenho 10 anos de experiência em liderança.",
            evidence: [{ source: "cv", quote: "10 anos de experiência em liderança" }],
          },
        ],
      }),
      corpus,
    );

    expect(result.coverLetter).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/citação verificável/);
  });

  it("descarta citações inventadas mas mantém as comprovadas", () => {
    const result = sanitizeApplicationDraft(
      draft({
        cover_letter: [
          {
            text: "Trabalho com Node.js e com Kubernetes.",
            evidence: [
              { source: "cv", quote: "Kubernetes em produção" },
              { source: "cv", quote: "foco em Node.js" },
            ],
          },
        ],
      }),
      corpus,
    );

    expect(result.coverLetter).toHaveLength(1);
    expect(result.coverLetter[0]!.evidence).toEqual([{ source: "cv", quote: "foco em Node.js" }]);
  });

  it("respeita as perguntas enviadas e descarta respostas de outras perguntas", () => {
    const result = sanitizeApplicationDraft(
      draft({
        answers: [
          {
            question: "Por que quer trabalhar aqui?",
            answer: "Pelo foco em Node.js.",
            evidence: [{ source: "cv", quote: "foco em Node.js" }],
          },
          {
            question: "Qual sua pretensão salarial?",
            answer: "R$ 10.000.",
            evidence: [{ source: "cv", quote: "Desenvolvedor Backend" }],
          },
        ],
      }),
      corpus,
      ["Por que quer trabalhar aqui?"],
    );

    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]!.question).toBe("Por que quer trabalhar aqui?");
    expect(result.warnings.join(" ")).toMatch(/não corresponder a uma pergunta enviada/);
  });

  it("sem perguntas, ignora respostas devolvidas pela IA", () => {
    const result = sanitizeApplicationDraft(
      draft({
        answers: [
          {
            question: "Pergunta qualquer",
            answer: "Resposta.",
            evidence: [{ source: "cv", quote: "Desenvolvedor Backend" }],
          },
        ],
      }),
      corpus,
      [],
    );

    expect(result.answers).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/sem pergunta correspondente/);
  });

  it("deduplica avisos e limita a quantidade", () => {
    const result = sanitizeApplicationDraft(
      draft({
        warnings: ["Atenção", "Atenção", "Outro aviso"],
      }),
      corpus,
    );

    expect(result.warnings).toEqual(["Atenção", "Outro aviso"]);
  });
});
