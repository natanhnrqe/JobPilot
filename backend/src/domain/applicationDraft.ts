import type { AnalysisEvidence } from "./analysis.js";

/**
 * Rascunho de candidatura (Fase 4, fatia 3).
 *
 * Regra central: a IA só pode afirmar o que está comprovado por uma citação
 * literal do perfil (`cv`) ou da vaga (`job`). Este módulo verifica cada
 * citação contra o texto enviado ao modelo e descarta o trecho que não tiver
 * comprovação — nada é inventado nem "corrigido" pelo sistema.
 */

export interface DraftEvidence {
  source: AnalysisEvidence;
  quote: string;
}

export interface DraftParagraph {
  text: string;
  evidence: DraftEvidence[];
}

export interface DraftAnswer {
  question: string;
  answer: string;
  evidence: DraftEvidence[];
}

export interface ApplicationDraftData {
  coverLetter: DraftParagraph[];
  answers: DraftAnswer[];
  warnings: string[];
}

/** Formato bruto devolvido pela IA (snake_case do contrato). */
export interface DraftAiInput {
  cover_letter: Array<{ text: string; evidence: DraftEvidence[] }>;
  answers: Array<{ question: string; answer: string; evidence: DraftEvidence[] }>;
  warnings: string[];
}

export interface DraftCorpus {
  cv: string;
  job: string;
}

/** Citação mínima para não aceitar palavras soltas como "prova". */
const MIN_QUOTE_CHARS = 8;

export function sanitizeApplicationDraft(
  input: DraftAiInput,
  corpus: DraftCorpus,
  requestedQuestions: string[] = [],
): ApplicationDraftData {
  const warnings: string[] = [];
  const addWarning = (warning: string): void => {
    const text = warning.trim();
    if (text !== "" && !warnings.includes(text)) warnings.push(text);
  };

  const normalizedCorpus: DraftCorpus = {
    cv: normalizeForMatch(corpus.cv),
    job: normalizeForMatch(corpus.job),
  };

  const verify = (evidence: DraftEvidence): DraftEvidence | null => {
    const quote = evidence.quote.trim();
    if (quote.length < MIN_QUOTE_CHARS) return null;
    const haystack = normalizedCorpus[evidence.source];
    if (!haystack.includes(normalizeForMatch(quote))) return null;
    return { source: evidence.source, quote };
  };

  const verifiedEvidence = (list: DraftEvidence[]): DraftEvidence[] => {
    const seen = new Set<string>();
    const result: DraftEvidence[] = [];
    for (const item of list) {
      const verified = verify(item);
      if (!verified) continue;
      const key = `${verified.source}:${normalizeForMatch(verified.quote)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(verified);
    }
    return result;
  };

  const coverLetter: DraftParagraph[] = [];
  for (const paragraph of input.cover_letter) {
    const text = paragraph.text.trim();
    if (text === "") continue;
    const evidence = verifiedEvidence(paragraph.evidence);
    if (evidence.length === 0) {
      addWarning(
        "Um trecho da carta foi removido por não ter citação verificável no perfil ou na vaga.",
      );
      continue;
    }
    coverLetter.push({ text, evidence });
  }

  const answers: DraftAnswer[] = [];
  if (requestedQuestions.length === 0) {
    if (input.answers.length > 0) {
      addWarning("Respostas sem pergunta correspondente foram ignoradas.");
    }
  } else {
    const seenQuestions = new Set<string>();
    for (const item of input.answers) {
      const answer = item.answer.trim();
      if (answer === "") continue;

      const question = matchRequestedQuestion(item.question, requestedQuestions);
      if (question === null) {
        addWarning(
          `A resposta sobre "${truncate(item.question.trim(), 80)}" foi ignorada por não corresponder a uma pergunta enviada.`,
        );
        continue;
      }
      const key = normalizeForMatch(question);
      if (seenQuestions.has(key)) continue;

      const evidence = verifiedEvidence(item.evidence);
      if (evidence.length === 0) {
        addWarning(
          `A resposta sobre "${truncate(question, 80)}" foi removida por não ter citação verificável.`,
        );
        continue;
      }

      seenQuestions.add(key);
      answers.push({ question, answer, evidence });
    }
  }

  const cleanWarnings: string[] = [];
  for (const warning of [...input.warnings, ...warnings]) {
    const text = warning.trim();
    if (text === "" || cleanWarnings.includes(text)) continue;
    cleanWarnings.push(text);
    if (cleanWarnings.length >= 10) break;
  }

  return {
    coverLetter: coverLetter.slice(0, 5),
    answers: answers.slice(0, 10),
    warnings: cleanWarnings,
  };
}

/** Normaliza para comparar citações: sem acentos, pontuação ou caixa. */
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Devolve a pergunta original enviada pelo usuário (ou null se não houver). */
function matchRequestedQuestion(rawQuestion: string, requested: string[]): string | null {
  const question = normalizeForMatch(rawQuestion);
  if (question === "") return null;
  for (const candidate of requested) {
    const normalized = normalizeForMatch(candidate);
    if (normalized === "" || normalized === question) return candidate;
    if (normalized.includes(question) || question.includes(normalized)) return candidate;
  }
  return null;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
