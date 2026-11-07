import type { AiCompletion, AiProvider } from "../src/ai/provider.js";

/**
 * Provedor de IA falso para testes OFFLINE: nenhuma chamada de rede é feita
 * e nenhuma chave real é necessária.
 */
export interface FakeAiOptions {
  /** Respostas devolvidas em sequência (a última repete). Pode ser função. */
  responses: string[] | ((call: number, system: string, user: string) => string);
  model?: string;
  /** Se definido, toda chamada lança este erro (provedor indisponível). */
  failWith?: Error;
}

export interface FakeAiProvider extends AiProvider {
  calls: Array<{ system: string; user: string }>;
}

export function makeFakeAi(options: FakeAiOptions): FakeAiProvider {
  const calls: Array<{ system: string; user: string }> = [];
  return {
    name: "fake",
    model: options.model ?? "fake-model",
    calls,
    async completeJson(system: string, user: string): Promise<AiCompletion> {
      calls.push({ system, user });
      if (options.failWith) throw options.failWith;
      const text =
        typeof options.responses === "function"
          ? options.responses(calls.length, system, user)
          : options.responses[Math.min(calls.length - 1, options.responses.length - 1)];
      return { text, model: this.model };
    },
  };
}

/** Payload JSON válido e completo de uma vaga de exemplo. */
export const VALID_EXTRACTION = JSON.stringify({
  title: "Estágio em Desenvolvimento Backend",
  company: "Acme Tecnologia",
  location: "São Paulo, SP",
  workMode: "hybrid",
  contractType: "internship",
  salaryText: "R$ 1.500/mês",
  postedAt: "2026-10-20",
  sourceUrl: null,
  descriptionText:
    "Estágio em desenvolvimento backend com Node.js. Requisitos: estudar computação, conhecer SQL. Desejável: Git.",
  extractionNotes: ["Nível identificado pela expressão 'estágio'"],
  confidence: "high",
});

/** Payload JSON válido da extração de CV (Seção 8.4, com source_quote). */
export const VALID_CV_EXTRACTION = JSON.stringify({
  personal: {
    fullName: { value: "Joao Silva", source_quote: "Joao Silva" },
    email: { value: "joao@example.com", source_quote: "joao@example.com" },
    phone: null,
    location: { value: "Sao Paulo, SP", source_quote: "Sao Paulo, SP" },
    linkedinUrl: null,
    githubUrl: null,
    portfolioUrl: null,
    summary: { value: "Desenvolvedor backend", source_quote: "Desenvolvedor backend" },
  },
  experiences: [
    {
      role: "Desenvolvedor Backend",
      company: "Acme",
      start: "2020-03",
      end: "2022-01",
      current: false,
      highlights: ["APIs em Node.js"],
      source_quote: "Desenvolvedor Backend na Acme (2020-2022)",
    },
  ],
  education: [
    {
      degree: "Bacharelado em Sistemas de Informacao",
      institution: "Universidade X",
      year: "2019",
      source_quote: "Bacharelado em Sistemas de Informacao - Universidade X (2019)",
    },
  ],
  skills: [{ name: "Node.js", level: "advanced", source_quote: "Node.js avancado" }],
  languages: [{ name: "Ingles", level: "intermediario", source_quote: "Ingles intermediario" }],
  projects: [
    {
      name: "JobPilot",
      url: "github.com/joao/jobpilot",
      description: "Aplicacao local",
      source_quote: "Projeto JobPilot",
    },
  ],
  inferred: [
    {
      field: "tempo_experiencia",
      value: "2 anos",
      reason: "Periodo entre 2020-03 e 2022-01",
    },
  ],
  extractionNotes: ["Dados extraidos do CV"],
});

/** Payload JSON válido da análise de compatibilidade (Seção 8.3). */
export const VALID_JOB_ANALYSIS = JSON.stringify({
  score: 82,
  summary: "Perfil atende ao requisito central de Node.js e à modalidade remota.",
  rationale: [
    {
      point: "A vaga pede Node.js e o perfil comprova experiência com a tecnologia.",
      evidence: "cv",
      quote: "Node.js avancado",
    },
    {
      point: "A vaga é remota, alinhada à preferência declarada.",
      evidence: "job",
      quote: "Vaga 100% remota",
    },
    {
      point: "O perfil tem experiência backend compatível com o cargo.",
      evidence: "cv",
      quote: "Desenvolvedor Backend na Acme",
    },
  ],
  requirements: [
    { text: "Node.js", kind: "required", match: "matched" },
    { text: "Ingles fluente", kind: "nice_to_have", match: "unknown" },
  ],
  gaps: [{ text: "A vaga pede 3 anos de experiencia; o perfil mostra 2.", severity: "minor" }],
  unknowns: ["Nivel de ingles nao informado no perfil"],
  recommend_apply: true,
  confidence: "high",
});

/** Segunda versão (re-análise) com score menor. */
export const VALID_JOB_ANALYSIS_2 = JSON.stringify({
  score: 64,
  summary: "Perfil atende parcialmente; ha lacuna de experiencia exigida.",
  rationale: [
    {
      point: "Node.js esta presente no perfil.",
      evidence: "cv",
      quote: "Node.js avancado",
    },
    {
      point: "A vaga exige 3 anos e o perfil indica 2.",
      evidence: "job",
      quote: "3 anos de experiencia",
    },
    {
      point: "A modalidade remota e compativel.",
      evidence: "cv",
      quote: "Remoto",
    },
  ],
  requirements: [{ text: "Node.js", kind: "required", match: "matched" }],
  gaps: [{ text: "Experiencia abaixo do exigido.", severity: "blocker" }],
  unknowns: [],
  recommend_apply: false,
  confidence: "medium",
});
