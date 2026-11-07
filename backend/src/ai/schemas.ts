import { z } from "zod";

/**
 * Saída estruturada esperada da IA ao extrair uma vaga (Seção 8.3 da
 * especificação). Tudo é anulável: campo não claramente identificável
 * DEVE ser null — a IA não inventa informações (Regra 8.1.2).
 */
export const extractedJobSchema = z.object({
  title: z.string().trim().min(1).max(300).nullable(),
  company: z.string().trim().min(1).max(200).nullable(),
  location: z.string().trim().max(200).nullable(),
  workMode: z.enum(["remote", "hybrid", "onsite"]).nullable(),
  contractType: z.enum(["internship", "junior", "mid", "senior", "freelance"]).nullable(),
  salaryText: z.string().trim().max(200).nullable(),
  postedAt: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}/.test(v), {
      message: "postedAt deve estar em ISO (YYYY-MM-DD) quando disponível",
    }),
  sourceUrl: z.string().trim().max(2000).nullable(),
  descriptionText: z.string().trim().min(1).max(20000).nullable(),
  /** Observações da própria extração (ex.: "nível inferido pela expressão 'estagiário'"). */
  extractionNotes: z.array(z.string().max(300)).max(10).default([]),
  confidence: z.enum(["high", "medium", "low"]),
});

export type ExtractedJob = z.infer<typeof extractedJobSchema>;

/**
 * Saída estruturada da extração de CV (Seção 8.4). Os nomes seguem o contrato
 * da especificação (`source_quote` em snake_case); a camada de serviço converte
 * para o domínio em camelCase.
 *
 * `source_quote` é opcional no schema de propósito: a regra da especificação é
 * DESCARTAR o item sem citação, não rejeitar a resposta inteira. Itens sem
 * citação são removidos em `sanitizeCvExtraction`.
 */
const cvQuoteSchema = z.string().trim().max(2000).optional().default("");

const cvQuotedValueSchema = z.object({
  value: z.string().trim().min(1).max(2000),
  source_quote: cvQuoteSchema,
});

export const cvExtractionSchema = z.object({
  personal: z
    .object({
      fullName: cvQuotedValueSchema.nullable().default(null),
      email: cvQuotedValueSchema.nullable().default(null),
      phone: cvQuotedValueSchema.nullable().default(null),
      location: cvQuotedValueSchema.nullable().default(null),
      linkedinUrl: cvQuotedValueSchema.nullable().default(null),
      githubUrl: cvQuotedValueSchema.nullable().default(null),
      portfolioUrl: cvQuotedValueSchema.nullable().default(null),
      summary: cvQuotedValueSchema.nullable().default(null),
    })
    .nullable()
    .default(null),
  experiences: z
    .array(
      z.object({
        role: z.string().trim().max(200).default(""),
        company: z.string().trim().max(200).nullable().default(null),
        start: z.string().trim().max(20).nullable().default(null),
        end: z.string().trim().max(20).nullable().default(null),
        current: z.boolean().default(false),
        highlights: z.array(z.string().trim().max(1000)).max(20).default([]),
        source_quote: cvQuoteSchema,
      }),
    )
    .max(50)
    .default([]),
  education: z
    .array(
      z.object({
        degree: z.string().trim().max(200).default(""),
        institution: z.string().trim().max(200).default(""),
        year: z.string().trim().max(40).nullable().default(null),
        source_quote: cvQuoteSchema,
      }),
    )
    .max(50)
    .default([]),
  skills: z
    .array(
      z.object({
        name: z.string().trim().max(100).default(""),
        level: z.enum(["beginner", "intermediate", "advanced"]).nullable().default(null),
        source_quote: cvQuoteSchema,
      }),
    )
    .max(100)
    .default([]),
  languages: z
    .array(
      z.object({
        name: z.string().trim().max(100).default(""),
        level: z.string().trim().max(100).nullable().default(null),
        source_quote: cvQuoteSchema,
      }),
    )
    .max(30)
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string().trim().max(200).default(""),
        url: z.string().trim().max(2000).nullable().default(null),
        description: z.string().trim().max(2000).nullable().default(null),
        source_quote: cvQuoteSchema,
      }),
    )
    .max(50)
    .default([]),
  /** Conclusões da IA; exigem confirmação explícita do usuário antes de salvar. */
  inferred: z
    .array(
      z.object({
        field: z.string().trim().min(1).max(100),
        value: z.string().trim().min(1).max(300),
        reason: z.string().trim().min(1).max(500),
      }),
    )
    .max(50)
    .default([]),
  extractionNotes: z.array(z.string().trim().max(500)).max(20).default([]),
});

export type CvExtraction = z.infer<typeof cvExtractionSchema>;

/** Normaliza a data de publicação: ISO ou YYYY-MM-DD; qualquer outra coisa → null (nunca "agora"). */
export function normalizePostedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  // ISO completo com hora
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}
