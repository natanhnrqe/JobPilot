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
