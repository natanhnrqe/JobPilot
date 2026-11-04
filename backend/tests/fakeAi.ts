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
