import { AppError, NotFoundError } from "../domain/errors.js";
import type { AiCompletion, AiProvider } from "../ai/provider.js";
import { jobAnalysisSchema, type JobAnalysis } from "../ai/schemas.js";
import { stripCodeFence } from "../ai/json.js";
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
} from "../ai/prompts.js";
import {
  buildAnalysisProfile,
  hasUsableProfile,
  sanitizeAnalysis,
  type JobAnalysisData,
} from "../domain/analysis.js";
import { getJobRow } from "../repositories/jobs.js";
import { getProfile } from "../repositories/profile.js";
import { insertAnalysis, toAnalysisDto, type JobAnalysisDto } from "../repositories/analyses.js";
import { recordEvent } from "../repositories/events.js";
import { completeWithBudget } from "./aiUsage.js";
import { requireAiProvider } from "./aiProvider.js";
import type { ServiceContext } from "./context.js";

/**
 * Análise de compatibilidade (Fase 3, fatia 3).
 *
 * Fluxo: perfil revisado + vaga → IA → validação zod → persistência versionada.
 * A IA NÃO altera o status da vaga, não descarta candidaturas e não inventa
 * qualificações. Toda análise fica no histórico; re-analisar cria nova versão.
 */

const MAX_DESCRIPTION_CHARS = 20_000;
const MIN_DESCRIPTION_CHARS = 30;

export async function analyzeJob(ctx: ServiceContext, jobId: number): Promise<JobAnalysisDto> {
  const provider = requireAiProvider(ctx, "Análise");
  const db = ctx.holder.get();

  const job = getJobRow(db, jobId);
  if (!job) throw new NotFoundError(`Vaga ${jobId} não encontrada.`);

  const stored = getProfile(db);
  if (!stored.hasProfile) {
    throw new AppError(
      "VALIDATION_ERROR",
      400,
      "Preencha ou importe seu perfil profissional antes de analisar a compatibilidade.",
    );
  }
  if (!hasUsableProfile(stored.profile)) {
    throw new AppError(
      "VALIDATION_ERROR",
      400,
      "Seu perfil não tem dados profissionais suficientes (experiências, formação, habilidades ou resumo). Complete o perfil antes de analisar.",
    );
  }

  const description = job.description_text?.trim() ?? "";
  if (description.length < MIN_DESCRIPTION_CHARS) {
    throw new AppError(
      "VALIDATION_ERROR",
      400,
      "Esta vaga não tem descrição suficiente para uma análise confiável. Complete a descrição da vaga antes de analisar.",
    );
  }

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

  const { data, raw, tokensIn, tokensOut } = await analyzeViaAi(
    ctx,
    provider,
    profileInput,
    stored.preferences,
    jobInput,
  );

  return db.withTransaction(() => {
    const row = insertAnalysis(db, {
      jobId,
      model: provider.model,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      data,
      rawJson: raw,
      tokensIn,
      tokensOut,
    });

    recordEvent(db, {
      jobId,
      type: "job.analysis_completed",
      actor: "system",
      message: `Análise de compatibilidade v${row.version}: ${row.score}/100`,
      meta: {
        analysisId: row.id,
        version: row.version,
        score: row.score,
        recommendApply: row.recommend_apply === 1,
        confidence: row.confidence,
        model: row.model,
      },
    });

    return toAnalysisDto(row);
  });
}

/** Pede a análise ao provedor, valida com zod e re-tenta uma vez em resposta inválida. */
async function analyzeViaAi(
  ctx: ServiceContext,
  provider: AiProvider,
  profile: unknown,
  preferences: unknown,
  job: unknown,
): Promise<{ data: JobAnalysisData; raw: string; tokensIn?: number; tokensOut?: number }> {
  const userPrompt = buildAnalysisUserPrompt({ profile, preferences, job });

  let lastError: AppError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let completion: AiCompletion;
    try {
      completion = await completeWithBudget(
        ctx,
        provider,
        "analysis",
        ANALYSIS_SYSTEM_PROMPT,
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
        `A IA não devolveu JSON válido para a análise (tentativa ${attempt}).`,
      );
      continue;
    }

    const validation = jobAnalysisSchema.safeParse(parsedJson);
    if (validation.success) {
      return {
        data: sanitizeAnalysis(toAnalysisData(validation.data)),
        raw: completion.text,
        tokensIn: completion.tokensIn,
        tokensOut: completion.tokensOut,
      };
    }

    lastError = new AppError(
      "AI_INVALID_RESPONSE",
      502,
      `A IA devolveu campos fora do esquema de análise (tentativa ${attempt}).`,
      {
        problemas: validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .slice(0, 10),
      },
    );
  }

  throw (
    lastError ??
    new AppError("AI_INVALID_RESPONSE", 502, "A IA não devolveu uma análise utilizável.")
  );
}

function toAnalysisData(analysis: JobAnalysis): JobAnalysisData {
  return {
    score: analysis.score,
    summary: analysis.summary,
    rationale: analysis.rationale,
    requirements: analysis.requirements,
    gaps: analysis.gaps,
    unknowns: analysis.unknowns,
    recommendApply: analysis.recommend_apply,
    confidence: analysis.confidence,
  };
}
