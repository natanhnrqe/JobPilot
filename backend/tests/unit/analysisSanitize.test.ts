import { describe, expect, it } from "vitest";
import {
  hasUsableProfile,
  normalizeScore,
  sanitizeAnalysis,
  type JobAnalysisData,
} from "../../src/domain/analysis.js";
import { emptyProfile, type ProfileData } from "../../src/domain/profile.js";

function baseAnalysis(overrides: Partial<JobAnalysisData> = {}): JobAnalysisData {
  return {
    score: 72,
    summary: "Resumo",
    rationale: [
      { point: "Ponto 1", evidence: "cv", quote: "trecho" },
      { point: "Ponto 2", evidence: "job", quote: "trecho" },
      { point: "Ponto 3", evidence: "cv", quote: "trecho" },
    ],
    requirements: [{ text: "Node.js", kind: "required", match: "matched" }],
    gaps: [{ text: "Lacuna", severity: "minor" }],
    unknowns: ["Idioma"],
    recommendApply: true,
    confidence: "medium",
    ...overrides,
  };
}

describe("normalizeScore", () => {
  it("arredonda e limita o score a 0..100", () => {
    expect(normalizeScore(72.4)).toBe(72);
    expect(normalizeScore(72.6)).toBe(73);
    expect(normalizeScore(-10)).toBe(0);
    expect(normalizeScore(150)).toBe(100);
    expect(normalizeScore(Number.NaN)).toBe(0);
  });
});

describe("sanitizeAnalysis", () => {
  it("remove requisitos, lacunas e desconhecidos duplicados ou vazios", () => {
    const result = sanitizeAnalysis(
      baseAnalysis({
        requirements: [
          { text: " Node.js ", kind: "required", match: "matched" },
          { text: "node.js", kind: "required", match: "matched" },
          { text: "   ", kind: "nice_to_have", match: "unknown" },
        ],
        gaps: [
          { text: "Ingles", severity: "minor" },
          { text: " ingles ", severity: "blocker" },
        ],
        unknowns: ["Idioma", "idioma", "  "],
      }),
    );

    expect(result.requirements).toEqual([{ text: "Node.js", kind: "required", match: "matched" }]);
    expect(result.gaps).toEqual([{ text: "Ingles", severity: "minor" }]);
    expect(result.unknowns).toEqual(["Idioma"]);
  });

  it("normaliza score e remove justificativas sem ponto", () => {
    const result = sanitizeAnalysis(
      baseAnalysis({
        score: 101,
        rationale: [
          { point: "  Ponto  ", evidence: "cv", quote: "  trecho  " },
          { point: "   ", evidence: "job", quote: "" },
        ],
      }),
    );

    expect(result.score).toBe(100);
    expect(result.rationale).toEqual([{ point: "Ponto", evidence: "cv", quote: "trecho" }]);
  });
});

describe("hasUsableProfile", () => {
  it("recusa perfil sem nenhum dado profissional", () => {
    expect(hasUsableProfile(emptyProfile())).toBe(false);
  });

  it("aceita perfil com habilidade, formação ou resumo", () => {
    const withSkill: ProfileData = {
      ...emptyProfile(),
      skills: [{ name: "Node.js", level: null, sourceQuote: "Node.js" }],
    };
    expect(hasUsableProfile(withSkill)).toBe(true);

    const withSummary: ProfileData = {
      ...emptyProfile(),
      personal: {
        ...emptyProfile().personal,
        summary: { value: "Desenvolvedor backend", sourceQuote: "Desenvolvedor backend" },
      },
    };
    expect(hasUsableProfile(withSummary)).toBe(true);
  });
});
