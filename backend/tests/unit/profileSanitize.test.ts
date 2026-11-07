import { describe, expect, it } from "vitest";
import type { CvExtraction } from "../../src/ai/schemas.js";
import { sanitizeCvExtraction } from "../../src/services/profile.js";

function emptyExtraction(): CvExtraction {
  return {
    personal: null,
    experiences: [],
    education: [],
    skills: [],
    languages: [],
    projects: [],
    inferred: [],
    extractionNotes: [],
  };
}

function personal(overrides: Partial<NonNullable<CvExtraction["personal"]>> = {}) {
  return {
    fullName: null,
    email: null,
    phone: null,
    location: null,
    linkedinUrl: null,
    githubUrl: null,
    portfolioUrl: null,
    summary: null,
    ...overrides,
  };
}

describe("sanitizeCvExtraction", () => {
  it("descarta experiência sem citação literal", () => {
    const result = sanitizeCvExtraction({
      ...emptyExtraction(),
      experiences: [
        {
          role: "Desenvolvedor",
          company: "Acme",
          start: "2020-01",
          end: "2021-01",
          current: false,
          highlights: [],
          source_quote: "",
        },
      ],
    });

    expect(result.profile.experiences).toHaveLength(0);
    expect(result.discarded).toBe(1);
    expect(result.warnings.join(" ")).toContain("não ter citação");
  });

  it("mantém experiência citada, normaliza datas e zera fim de vínculo atual", () => {
    const result = sanitizeCvExtraction({
      ...emptyExtraction(),
      experiences: [
        {
          role: "Desenvolvedor Backend",
          company: "Acme",
          start: "2020-03-15",
          end: "2021-12-01",
          current: false,
          highlights: ["APIs em Node.js", "  "],
          source_quote: "Desenvolvedor Backend na Acme (mar/2020 - dez/2021)",
        },
        {
          role: "Analista",
          company: null,
          start: "2022",
          end: "2023-05",
          current: true,
          highlights: [],
          source_quote: "Analista desde 2022",
        },
      ],
    });

    expect(result.profile.experiences).toEqual([
      {
        role: "Desenvolvedor Backend",
        company: "Acme",
        start: "2020-03",
        end: "2021-12",
        current: false,
        highlights: ["APIs em Node.js"],
        sourceQuote: "Desenvolvedor Backend na Acme (mar/2020 - dez/2021)",
      },
      {
        role: "Analista",
        company: null,
        start: "2022",
        end: null,
        current: true,
        highlights: [],
        sourceQuote: "Analista desde 2022",
      },
    ]);
    expect(result.discarded).toBe(0);
  });

  it("descarta dados pessoais sem citação e normaliza e-mail/URL", () => {
    const result = sanitizeCvExtraction({
      ...emptyExtraction(),
      personal: personal({
        fullName: { value: "Joao Silva", source_quote: "Joao Silva" },
        email: { value: "joao@example.com", source_quote: "joao@example.com" },
        phone: { value: "+55 11 99999-0000", source_quote: "" },
        linkedinUrl: { value: "linkedin.com/in/joao", source_quote: "linkedin.com/in/joao" },
        githubUrl: { value: "https://github.com/joao", source_quote: "github.com/joao" },
      }),
    });

    expect(result.profile.personal.fullName).toEqual({
      value: "Joao Silva",
      sourceQuote: "Joao Silva",
    });
    expect(result.profile.personal.email?.value).toBe("joao@example.com");
    expect(result.profile.personal.phone).toBeNull();
    expect(result.profile.personal.linkedinUrl?.value).toBe("https://linkedin.com/in/joao");
    expect(result.profile.personal.githubUrl?.value).toBe("https://github.com/joao");
    expect(result.discarded).toBe(1);
  });

  it("descarta e-mail inválido mesmo com citação", () => {
    const result = sanitizeCvExtraction({
      ...emptyExtraction(),
      personal: personal({
        email: { value: "joao arroba exemplo", source_quote: "joao arroba exemplo" },
      }),
    });

    expect(result.profile.personal.email).toBeNull();
    expect(result.discarded).toBe(1);
  });

  it("remove URL inválida de projeto sem descartar o projeto", () => {
    const result = sanitizeCvExtraction({
      ...emptyExtraction(),
      projects: [
        {
          name: "JobPilot",
          url: "não é uma url",
          description: "App local",
          source_quote: "Projeto JobPilot",
        },
      ],
    });

    expect(result.profile.projects).toHaveLength(1);
    expect(result.profile.projects[0]?.url).toBeNull();
    expect(result.warnings.join(" ")).toContain("URL inválida");
    expect(result.discarded).toBe(0);
  });

  it("marca itens inferidos como não confirmados", () => {
    const result = sanitizeCvExtraction({
      ...emptyExtraction(),
      inferred: [
        {
          field: "tempo_experiencia",
          value: "4 anos",
          reason: "Soma dos períodos das experiências",
        },
      ],
    });

    expect(result.profile.inferred).toEqual([
      {
        field: "tempo_experiencia",
        value: "4 anos",
        reason: "Soma dos períodos das experiências",
        confirmed: false,
      },
    ]);
  });
});
