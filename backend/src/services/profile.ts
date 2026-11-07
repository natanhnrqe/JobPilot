import { AppError } from "../domain/errors.js";
import type { AiCompletion, AiProvider } from "../ai/provider.js";
import { cvExtractionSchema, type CvExtraction } from "../ai/schemas.js";
import { CV_EXTRACTION_SYSTEM_PROMPT, buildCvExtractionUserPrompt } from "../ai/prompts.js";
import {
  normalizeEmail,
  normalizeMonth,
  normalizeUrl,
  type ProfileAnswers,
  type ProfileData,
  type ProfileExperience,
  type ProfilePreferences,
  type QuotedText,
} from "../domain/profile.js";
import { getProfile, saveProfile, type StoredProfile } from "../repositories/profile.js";
import { extractCvText, type CvFormat } from "./cvText.js";
import { completeWithBudget } from "./aiUsage.js";
import type { ServiceContext } from "./context.js";

/** Limite do texto enviado à IA (o texto completo fica disponível para revisão). */
const MAX_CV_TEXT_FOR_AI = 40_000;

export interface CvExtractionPreview {
  profile: ProfileData;
  rawText: string;
  warnings: string[];
  discarded: number;
  meta: {
    provider: string;
    model: string;
    fileName: string;
    format: CvFormat;
    contentLength: number;
  };
}

export interface ConfirmProfileInput {
  rawCvText: string;
  profile: ProfileData;
  preferences?: ProfilePreferences;
  answers?: ProfileAnswers;
}

export interface UpdateProfileInput {
  profile?: ProfileData;
  preferences?: ProfilePreferences;
  answers?: ProfileAnswers;
}

function requireProvider(ctx: ServiceContext): AiProvider {
  if (!ctx.ai) {
    throw new AppError(
      "AI_UNAVAILABLE",
      503,
      "Importação de currículo por IA indisponível: nenhuma chave configurada. Defina AI_API_KEY no arquivo .env (o restante do JobPilot funciona normalmente).",
    );
  }
  return ctx.ai;
}

/**
 * Lê o arquivo (PDF/DOCX/TXT), pede a extração à IA e devolve uma PRÉVIA.
 * Nada é gravado no banco: a persistência só acontece em `confirmProfile`,
 * depois da revisão humana (Seção 8.1).
 */
export async function extractProfileFromCv(
  ctx: ServiceContext,
  input: { fileName: string; content: Buffer },
): Promise<CvExtractionPreview> {
  const provider = requireProvider(ctx);
  const cv = await extractCvText(input);

  const { extracted } = await extractCvViaAi(
    ctx,
    provider,
    cv.text.slice(0, MAX_CV_TEXT_FOR_AI),
    input.fileName,
  );
  const sanitized = sanitizeCvExtraction(extracted);
  const warnings = [
    ...sanitized.warnings,
    ...summarizeMissingSections(sanitized.profile),
    ...summarizeInferred(sanitized.profile),
  ];

  return {
    profile: sanitized.profile,
    rawText: cv.text,
    warnings,
    discarded: sanitized.discarded,
    meta: {
      provider: provider.name,
      model: provider.model,
      fileName: input.fileName,
      format: cv.format,
      contentLength: cv.text.length,
    },
  };
}

/** Pede a extração ao provedor, valida com zod e re-tenta uma vez em resposta inválida. */
async function extractCvViaAi(
  ctx: ServiceContext,
  provider: AiProvider,
  text: string,
  fileName: string,
): Promise<{ extracted: CvExtraction; tokensIn?: number; tokensOut?: number }> {
  const userPrompt = buildCvExtractionUserPrompt({ text, fileName });

  let lastError: AppError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let completion: AiCompletion;
    try {
      completion = await completeWithBudget(
        ctx,
        provider,
        "cv",
        CV_EXTRACTION_SYSTEM_PROMPT,
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
        `A IA não devolveu JSON válido para o currículo (tentativa ${attempt}).`,
      );
      continue;
    }

    const validation = cvExtractionSchema.safeParse(parsedJson);
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
      `A IA devolveu campos fora do esquema de currículo (tentativa ${attempt}).`,
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

function stripCodeFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  return fenced?.[1] ?? text.trim();
}

/**
 * Converte a saída da IA no perfil do domínio e aplica a regra da citação:
 * todo item sem `source_quote` é descartado (nunca "corrigido" pela IA).
 */
export function sanitizeCvExtraction(extracted: CvExtraction): {
  profile: ProfileData;
  warnings: string[];
  discarded: number;
} {
  const warnings: string[] = [];
  let discarded = 0;

  function drop(label: string, reason: string): void {
    discarded++;
    warnings.push(`${label}: ${reason}`);
  }

  function quoted(
    item: { value: string; source_quote: string } | null | undefined,
    label: string,
    transform?: (value: string) => string | null,
  ): QuotedText | null {
    if (!item) return null;
    const rawValue = item.value.trim();
    if (!rawValue) return null;
    const sourceQuote = item.source_quote.trim();
    if (!sourceQuote) {
      drop(label, "descartado por não ter citação literal no currículo.");
      return null;
    }
    const value = transform ? transform(rawValue) : rawValue;
    if (!value) {
      drop(label, `valor inválido descartado ("${rawValue}").`);
      return null;
    }
    return { value, sourceQuote };
  }

  const personal = extracted.personal;
  const profile: ProfileData = {
    personal: {
      fullName: quoted(personal?.fullName, "Nome completo"),
      email: quoted(personal?.email, "E-mail", normalizeEmail),
      phone: quoted(personal?.phone, "Telefone"),
      location: quoted(personal?.location, "Localização"),
      linkedinUrl: quoted(personal?.linkedinUrl, "LinkedIn", normalizeUrl),
      githubUrl: quoted(personal?.githubUrl, "GitHub", normalizeUrl),
      portfolioUrl: quoted(personal?.portfolioUrl, "Portfólio", normalizeUrl),
      summary: quoted(personal?.summary, "Resumo"),
    },
    experiences: [],
    education: [],
    skills: [],
    languages: [],
    projects: [],
    inferred: extracted.inferred.map((item) => ({ ...item, confirmed: false })),
  };

  for (const item of extracted.experiences) {
    const role = item.role.trim();
    if (!role) {
      drop("Experiência", "descartada por não ter cargo identificado.");
      continue;
    }
    const sourceQuote = item.source_quote.trim();
    if (!sourceQuote) {
      drop(`Experiência "${role}"`, "descartada por não ter citação literal no currículo.");
      continue;
    }
    const experience: ProfileExperience = {
      role,
      company: item.company?.trim() || null,
      start: normalizeMonth(item.start),
      end: item.current ? null : normalizeMonth(item.end),
      current: item.current,
      highlights: item.highlights.map((h) => h.trim()).filter((h) => h !== ""),
      sourceQuote,
    };
    profile.experiences.push(experience);
  }

  for (const item of extracted.education) {
    const degree = item.degree.trim();
    const institution = item.institution.trim();
    if (!degree && !institution) {
      drop("Formação", "descartada por não ter curso nem instituição.");
      continue;
    }
    const sourceQuote = item.source_quote.trim();
    if (!sourceQuote) {
      drop(
        `Formação "${degree || institution}"`,
        "descartada por não ter citação literal no currículo.",
      );
      continue;
    }
    profile.education.push({
      degree,
      institution,
      year: item.year?.trim() || null,
      sourceQuote,
    });
  }

  for (const item of extracted.skills) {
    const name = item.name.trim();
    if (!name) {
      drop("Habilidade", "descartada por não ter nome.");
      continue;
    }
    const sourceQuote = item.source_quote.trim();
    if (!sourceQuote) {
      drop(`Habilidade "${name}"`, "descartada por não ter citação literal no currículo.");
      continue;
    }
    profile.skills.push({ name, level: item.level, sourceQuote });
  }

  for (const item of extracted.languages) {
    const name = item.name.trim();
    if (!name) {
      drop("Idioma", "descartado por não ter nome.");
      continue;
    }
    const sourceQuote = item.source_quote.trim();
    if (!sourceQuote) {
      drop(`Idioma "${name}"`, "descartado por não ter citação literal no currículo.");
      continue;
    }
    profile.languages.push({
      name,
      level: item.level?.trim() || null,
      sourceQuote,
    });
  }

  for (const item of extracted.projects) {
    const name = item.name.trim();
    if (!name) {
      drop("Projeto", "descartado por não ter nome.");
      continue;
    }
    const sourceQuote = item.source_quote.trim();
    if (!sourceQuote) {
      drop(`Projeto "${name}"`, "descartado por não ter citação literal no currículo.");
      continue;
    }
    const rawUrl = item.url?.trim() || null;
    const url = normalizeUrl(rawUrl);
    if (rawUrl && !url) {
      warnings.push(`Projeto "${name}": URL inválida removida ("${rawUrl}").`);
    }
    profile.projects.push({
      name,
      url,
      description: item.description?.trim() || null,
      sourceQuote,
    });
  }

  return { profile, warnings, discarded };
}

function summarizeMissingSections(profile: ProfileData): string[] {
  const warnings: string[] = [];
  if (profile.experiences.length === 0) {
    warnings.push(
      "Nenhuma experiência profissional identificada no currículo. Você pode adicionar manualmente.",
    );
  }
  if (profile.education.length === 0) {
    warnings.push("Nenhuma formação acadêmica identificada no currículo.");
  }
  if (profile.skills.length === 0) {
    warnings.push("Nenhuma habilidade identificada no currículo.");
  }
  if (profile.languages.length === 0) {
    warnings.push("Nenhum idioma identificado no currículo.");
  }
  return warnings;
}

function summarizeInferred(profile: ProfileData): string[] {
  if (profile.inferred.length === 0) return [];
  return [
    `${profile.inferred.length} item(ns) foram inferidos pela IA e precisam da sua confirmação antes de salvar.`,
  ];
}

/**
 * Confirma a versão revisada do CV. Itens inferidos só entram com
 * `confirmed: true`; caso contrário, a confirmação é recusada.
 */
export function confirmProfile(ctx: ServiceContext, input: ConfirmProfileInput): StoredProfile {
  assertInferredConfirmed(input.profile);
  const current = getProfile(ctx.holder.get());

  return saveProfile(ctx.holder.get(), {
    rawCvText: input.rawCvText,
    profile: input.profile,
    preferences: input.preferences ?? current.preferences,
    answers: input.answers ?? current.answers,
  });
}

/** Edição manual (sem novo CV): preserva o texto do CV já salvo. */
export function updateProfile(ctx: ServiceContext, input: UpdateProfileInput): StoredProfile {
  const current = getProfile(ctx.holder.get());
  const profile = input.profile ?? current.profile;
  assertInferredConfirmed(profile);

  return saveProfile(ctx.holder.get(), {
    profile,
    preferences: input.preferences ?? current.preferences,
    answers: input.answers ?? current.answers,
  });
}

function assertInferredConfirmed(profile: ProfileData): void {
  const pending = profile.inferred.filter((item) => !item.confirmed);
  if (pending.length === 0) return;

  throw new AppError(
    "VALIDATION_ERROR",
    400,
    "Confirme ou remova os itens inferidos pela IA antes de salvar o perfil.",
    {
      itens: pending.map((item) => ({ campo: item.field, valor: item.value, motivo: item.reason })),
    },
  );
}
