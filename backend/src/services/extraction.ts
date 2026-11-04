import { AppError } from "../domain/errors.js";
import type { AiCompletion, AiProvider } from "../ai/provider.js";
import { extractedJobSchema, normalizePostedAt, type ExtractedJob } from "../ai/schemas.js";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserPrompt } from "../ai/prompts.js";
import { findPossibleDuplicates, type DuplicateCandidate } from "../domain/dedupe.js";
import { fetchJobPage, type SafeFetchOptions } from "../fetch/safeFetch.js";
import { htmlToText } from "../fetch/htmlText.js";
import type { ServiceContext } from "./context.js";

export interface JobDraft {
  title: string | null;
  company: string | null;
  location: string | null;
  workMode: "remote" | "hybrid" | "onsite" | null;
  contractType: "internship" | "junior" | "mid" | "senior" | "freelance" | null;
  salaryText: string | null;
  postedAt: string | null;
  sourceUrl: string | null;
  descriptionText: string | null;
}

export interface ExtractionResult {
  draft: JobDraft;
  confidence: "high" | "medium" | "low";
  extractionNotes: string[];
  warnings: string[];
  possibleDuplicates: DuplicateCandidate[];
  meta: {
    provider: string;
    model: string;
    contentSource: "texto" | "url";
    contentLength: number;
  };
}

const MAX_CONTENT_CHARS = 20000;

function requireProvider(ctx: ServiceContext): AiProvider {
  if (!ctx.ai) {
    throw new AppError(
      "AI_UNAVAILABLE",
      503,
      "Extração por IA indisponível: nenhuma chave configurada. Defina AI_API_KEY no arquivo .env (o restante do JobPilot funciona normalmente).",
    );
  }
  return ctx.ai;
}

/** Pede a extração ao provedor, valida com zod e re-tenta uma vez em resposta inválida. */
async function extractViaAi(
  provider: AiProvider,
  content: string,
  urlHint: string | null,
): Promise<{ extracted: ExtractedJob; tokensIn?: number; tokensOut?: number }> {
  const userPrompt = buildExtractionUserPrompt({ content, urlHint });

  let lastError: AppError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let completion: AiCompletion;
    try {
      completion = await provider.completeJson(EXTRACTION_SYSTEM_PROMPT, userPrompt);
    } catch (err) {
      // Falha do provedor (rede, cota, chave) não é retentada aqui: vira 503 claro.
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
        `A IA não devolveu JSON válido (tentativa ${attempt}).`,
      );
      continue;
    }
    const validation = extractedJobSchema.safeParse(parsedJson);
    if (validation.success) {
      return {
        extracted: validation.data,
        tokensIn: completion.tokensIn,
        tokensOut: completion.tokensOut,
      };
    }
    lastError = new AppError(
      "AI_INVALID_RESPONSE",
      502,
      `A IA devolveu campos fora do esquema (tentativa ${attempt}).`,
      {
        problemas: validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .slice(0, 10),
      },
    );
  }
  throw (
    lastError ??
    new AppError("AI_INVALID_RESPONSE", 502, "A IA não devolveu uma resposta utilizável.")
  );
}

/** Remove cercas de código ("```json ... ```") que alguns modelos acrescentam. */
function stripCodeFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  return fenced?.[1] ?? text.trim();
}

function toDraft(extracted: ExtractedJob, urlHint: string | null): JobDraft {
  return {
    title: extracted.title,
    company: extracted.company,
    location: extracted.location,
    workMode: extracted.workMode,
    contractType: extracted.contractType,
    salaryText: extracted.salaryText,
    postedAt: normalizePostedAt(extracted.postedAt),
    sourceUrl: extracted.sourceUrl ?? urlHint,
    descriptionText: extracted.descriptionText,
  };
}

/** Extração a partir de texto colado pelo usuário (fonte: usuário). */
export async function extractJobFromText(
  ctx: ServiceContext,
  input: { text: string; sourceUrl?: string | null },
): Promise<ExtractionResult> {
  const provider = requireProvider(ctx);
  const content = input.text.trim();
  const urlHint = input.sourceUrl?.trim() || null;

  const { extracted } = await extractViaAi(provider, content.slice(0, MAX_CONTENT_CHARS), urlHint);
  const draft = toDraft(extracted, urlHint);

  const warnings: string[] = [];
  if (!draft.title)
    warnings.push("Título não identificado — preencha manualmente antes de salvar.");
  if (!draft.descriptionText) warnings.push("Descrição não identificada no texto.");
  if (!extracted.postedAt && /data|publicad/i.test(content.slice(0, 500))) {
    warnings.push("Data de publicação não confirmada; deixada vazia em vez de usar a data atual.");
  }

  return {
    draft,
    confidence: extracted.confidence,
    extractionNotes: extracted.extractionNotes,
    warnings,
    possibleDuplicates: findPossibleDuplicates(ctx.holder.get(), {
      sourceUrl: draft.sourceUrl,
      title: draft.title,
      company: draft.company,
    }),
    meta: {
      provider: provider.name,
      model: provider.model,
      contentSource: "texto",
      contentLength: content.length,
    },
  };
}

/** Extração a partir de uma URL: busca o conteúdo (com proteções) e extrai. */
export async function extractJobFromUrl(
  ctx: ServiceContext,
  input: { url: string; fetchOptions?: SafeFetchOptions },
): Promise<ExtractionResult> {
  const provider = requireProvider(ctx);

  const page = await fetchJobPage(input.url, input.fetchOptions);
  const text = htmlToText(page.content);
  if (text.trim().length < 30) {
    throw new AppError(
      "FETCH_ERROR",
      422,
      "A página foi obtida, mas não contém texto suficiente para extração. Tente colar a descrição manualmente.",
      { url: page.finalUrl },
    );
  }

  const { extracted } = await extractViaAi(
    provider,
    text.slice(0, MAX_CONTENT_CHARS),
    page.finalUrl,
  );
  const draft = toDraft(extracted, page.finalUrl);

  const warnings: string[] = [];
  if (!draft.title)
    warnings.push("Título não identificado — preencha manualmente antes de salvar.");
  if (!draft.descriptionText) warnings.push("Descrição não identificada na página.");
  warnings.push(
    "Conteúdo obtido por HTTP simples: páginas que exigem JavaScript/login podem ficar incompletas — confira a prévia antes de salvar.",
  );

  return {
    draft,
    confidence: extracted.confidence,
    extractionNotes: extracted.extractionNotes,
    warnings,
    possibleDuplicates: findPossibleDuplicates(ctx.holder.get(), {
      sourceUrl: draft.sourceUrl,
      title: draft.title,
      company: draft.company,
    }),
    meta: {
      provider: provider.name,
      model: provider.model,
      contentSource: "url",
      contentLength: text.length,
    },
  };
}
