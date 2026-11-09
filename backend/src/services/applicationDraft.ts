import { AppError, NotFoundError, ValidationError } from "../domain/errors.js";
import type { AiCompletion, AiProvider } from "../ai/provider.js";
import { applicationDraftSchema } from "../ai/schemas.js";
import { stripCodeFence } from "../ai/json.js";
import { DRAFT_PROMPT_VERSION, DRAFT_SYSTEM_PROMPT, buildDraftUserPrompt } from "../ai/prompts.js";
import { buildAnalysisProfile, hasUsableProfile } from "../domain/analysis.js";
import {
  sanitizeApplicationDraft,
  type ApplicationDraftData,
  type DraftAnswer,
  type DraftCorpus,
  type DraftParagraph,
} from "../domain/applicationDraft.js";
import { getJobRow } from "../repositories/jobs.js";
import { getProfile } from "../repositories/profile.js";
import { recordEvent } from "../repositories/events.js";
import { completeWithBudget } from "./aiUsage.js";
import { requireAiProvider } from "./aiProvider.js";
import type { ServiceContext } from "./context.js";

/**
 * Rascunho de candidatura com IA (Fase 4, fatia 3).
 *
 * Fluxo: perfil revisado + vaga (+ perguntas do formulário) → IA → validação
 * zod → verificação das citações → resposta. Nada é persistido como
 * candidatura e nada é enviado: a pessoa revisa, edita e usa o texto.
 *
 * Toda chamada passa por `completeWithBudget` (tipo `draft`), então respeita
 * o teto diário de IA.
 */

const MAX_DESCRIPTION_CHARS = 20_000;
const MIN_DESCRIPTION_CHARS = 30;
const MAX_QUESTIONS = 10;
const MAX_QUESTION_CHARS = 300;

export interface ApplicationDraftDto {
  jobId: number;
  model: string;
  promptVersion: string;
  generatedAt: string;
  coverLetter: DraftParagraph[];
  /** Carta completa em texto plano, pronta para revisar/copiar. */
  coverLetterText: string;
  answers: DraftAnswer[];
  warnings: string[];
  tokensIn: number | null;
  tokensOut: number | null;
}

export async function generateApplicationDraft(
  ctx: ServiceContext,
  jobId: number,
  questionsInput: string[] = [],
): Promise<ApplicationDraftDto> {
  const provider = requireAiProvider(ctx, "Rascunho de candidatura");
  const db = ctx.holder.get();

  const job = getJobRow(db, jobId);
  if (!job) throw new NotFoundError(`Vaga ${jobId} não encontrada.`);

  const stored = getProfile(db);
  if (!stored.hasProfile) {
    throw new ValidationError(
      "Preencha ou importe seu perfil profissional antes de gerar um rascunho de candidatura.",
    );
  }
  if (!hasUsableProfile(stored.profile)) {
    throw new ValidationError(
      "Seu perfil não tem dados profissionais suficientes (experiências, formação, habilidades ou resumo). Complete o perfil antes de gerar o rascunho.",
    );
  }

  const description = job.description_text?.trim() ?? "";
  if (description.length < MIN_DESCRIPTION_CHARS) {
    throw new ValidationError(
      "Esta vaga não tem descrição suficiente para um rascunho confiável. Complete a descrição da vaga antes de gerar.",
    );
  }

  const questions = normalizeQuestions(questionsInput);
  const profileInput = buildAnalysisProfile(stored.profile);
  const jobInput = {
    title: job.title,
    company: job.company,
    location: job.location,
    workMode: job.work_mode,
    contractType: job.contract_type,
    salaryText: job.salary_text,
    postedAt: job.posted_at,
    description: description.slice(0, MAX_DESCRIPTION_CHARS),
  };

  // Citações são verificadas contra exatamente o que foi enviado à IA.
  const corpus: DraftCorpus = {
    cv: JSON.stringify(profileInput),
    job: JSON.stringify(jobInput),
  };

  const { data, tokensIn, tokensOut } = await draftViaAi(
    ctx,
    provider,
    profileInput,
    stored.preferences,
    jobInput,
    questions,
    corpus,
  );

  recordEvent(db, {
    jobId,
    type: "job.application_draft_generated",
    actor: "system",
    message: "Rascunho de candidatura gerado",
    meta: {
      model: provider.model,
      promptVersion: DRAFT_PROMPT_VERSION,
      questions: questions.length,
    },
  });

  return {
    jobId,
    model: provider.model,
    promptVersion: DRAFT_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    ...data,
    coverLetterText: data.coverLetter.map((paragraph) => paragraph.text).join("\n\n"),
    tokensIn: tokensIn ?? null,
    tokensOut: tokensOut ?? null,
  };
}

/** Perguntas do formulário: trim, sem duplicatas, no máximo 10. */
function normalizeQuestions(input: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    const question = raw.trim();
    if (question === "") continue;
    if (question.length > MAX_QUESTION_CHARS) {
      throw new ValidationError(
        `Cada pergunta deve ter no máximo ${MAX_QUESTION_CHARS} caracteres.`,
      );
    }
    const key = question.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(question);
  }

  if (result.length > MAX_QUESTIONS) {
    throw new ValidationError(`Envie no máximo ${MAX_QUESTIONS} perguntas por rascunho.`);
  }

  return result;
}

/** Pede o rascunho ao provedor, valida o esquema e re-tenta uma vez se inválido. */
async function draftViaAi(
  ctx: ServiceContext,
  provider: AiProvider,
  profile: unknown,
  preferences: unknown,
  job: unknown,
  questions: string[],
  corpus: DraftCorpus,
): Promise<{
  data: ApplicationDraftData;
  tokensIn?: number;
  tokensOut?: number;
}> {
  const userPrompt = buildDraftUserPrompt({ profile, preferences, job, questions });

  let lastError: AppError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let completion: AiCompletion;
    try {
      completion = await completeWithBudget(
        ctx,
        provider,
        "draft",
        DRAFT_SYSTEM_PROMPT,
        userPrompt,
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        "AI_UNAVAILABLE",
        503,
        `Falha ao consultar o provedor de IA: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripCodeFence(completion.text));
    } catch {
      lastError = new AppError(
        "AI_INVALID_RESPONSE",
        502,
        `A IA não devolveu JSON válido para o rascunho (tentativa ${attempt}).`,
      );
      continue;
    }

    const validation = applicationDraftSchema.safeParse(parsedJson);
    if (!validation.success) {
      lastError = new AppError(
        "AI_INVALID_RESPONSE",
        502,
        `A IA devolveu campos fora do esquema do rascunho (tentativa ${attempt}).`,
        {
          problemas: validation.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .slice(0, 10),
        },
      );
      continue;
    }

    const data = sanitizeApplicationDraft(validation.data, corpus, questions);
    if (data.coverLetter.length === 0) {
      lastError = new AppError(
        "AI_INVALID_RESPONSE",
        502,
        `A IA não produziu uma carta com citações verificáveis (tentativa ${attempt}).`,
      );
      continue;
    }

    return {
      data,
      tokensIn: completion.tokensIn,
      tokensOut: completion.tokensOut,
    };
  }

  throw (
    lastError ??
    new AppError("AI_INVALID_RESPONSE", 502, "A IA não devolveu um rascunho utilizável.")
  );
}
