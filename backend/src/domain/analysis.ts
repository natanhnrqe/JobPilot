import type { ProfileData } from "./profile.js";

/**
 * Análise de compatibilidade entre vaga e perfil (Fase 3, fatia 3).
 *
 * A IA apenas SUGERE score, justificativas e uma recomendação. Ela nunca
 * altera o status da vaga nem inventa qualificações: requisitos ausentes no
 * perfil viram `unknown` (e não "não atende") para não penalizar o candidato
 * por omissão de informação.
 */

export const ANALYSIS_CONFIDENCES = ["low", "medium", "high"] as const;
export type AnalysisConfidence = (typeof ANALYSIS_CONFIDENCES)[number];

export const REQUIREMENT_KINDS = ["required", "nice_to_have"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const REQUIREMENT_MATCHES = ["matched", "missing", "unknown"] as const;
export type RequirementMatch = (typeof REQUIREMENT_MATCHES)[number];

export const GAP_SEVERITIES = ["blocker", "minor"] as const;
export type GapSeverity = (typeof GAP_SEVERITIES)[number];

export const ANALYSIS_EVIDENCES = ["cv", "job"] as const;
export type AnalysisEvidence = (typeof ANALYSIS_EVIDENCES)[number];

export interface AnalysisRationale {
  point: string;
  evidence: AnalysisEvidence;
  quote: string;
}

export interface AnalysisRequirement {
  text: string;
  kind: RequirementKind;
  match: RequirementMatch;
}

export interface AnalysisGap {
  text: string;
  severity: GapSeverity;
}

export interface JobAnalysisData {
  score: number;
  summary: string;
  rationale: AnalysisRationale[];
  requirements: AnalysisRequirement[];
  gaps: AnalysisGap[];
  unknowns: string[];
  recommendApply: boolean;
  confidence: AnalysisConfidence;
}

/** Score sempre inteiro entre 0 e 100 (a IA pode devolver decimal). */
export function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Limpeza final antes de persistir: remove itens vazios/duplicados e garante
 * que o score esteja no intervalo. O schema zod já validou os tipos.
 */
export function sanitizeAnalysis(input: JobAnalysisData): JobAnalysisData {
  const seenRequirements = new Set<string>();
  const requirements: AnalysisRequirement[] = [];
  for (const item of input.requirements) {
    const text = item.text.trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase("pt-BR");
    if (seenRequirements.has(key)) continue;
    seenRequirements.add(key);
    requirements.push({ text, kind: item.kind, match: item.match });
  }

  const seenGaps = new Set<string>();
  const gaps: AnalysisGap[] = [];
  for (const item of input.gaps) {
    const text = item.text.trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase("pt-BR");
    if (seenGaps.has(key)) continue;
    seenGaps.add(key);
    gaps.push({ text, severity: item.severity });
  }

  const seenUnknowns = new Set<string>();
  const unknowns: string[] = [];
  for (const value of input.unknowns) {
    const text = value.trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase("pt-BR");
    if (seenUnknowns.has(key)) continue;
    seenUnknowns.add(key);
    unknowns.push(text);
  }

  return {
    score: normalizeScore(input.score),
    summary: input.summary.trim(),
    rationale: input.rationale
      .map((item) => ({
        point: item.point.trim(),
        evidence: item.evidence,
        quote: item.quote.trim(),
      }))
      .filter((item) => item.point !== ""),
    requirements,
    gaps,
    unknowns,
    recommendApply: input.recommendApply,
    confidence: input.confidence,
  };
}

/**
 * O perfil precisa ter alguma substância profissional. Só nome/e-mail não é
 * suficiente para uma análise útil (e gastaria tokens sem base).
 */
export function hasUsableProfile(profile: ProfileData): boolean {
  return (
    profile.experiences.length > 0 ||
    profile.education.length > 0 ||
    profile.skills.length > 0 ||
    profile.languages.length > 0 ||
    profile.projects.length > 0 ||
    profile.personal.summary !== null
  );
}

/**
 * Versão compacta enviada à IA: sem citações e com limites por seção para
 * manter o prompt previsível. O perfil salvo continua completo no banco.
 */
export function buildAnalysisProfile(profile: ProfileData): Record<string, unknown> {
  return {
    personal: {
      fullName: profile.personal.fullName?.value ?? null,
      location: profile.personal.location?.value ?? null,
      summary: profile.personal.summary?.value ?? null,
      linkedinUrl: profile.personal.linkedinUrl?.value ?? null,
      githubUrl: profile.personal.githubUrl?.value ?? null,
      portfolioUrl: profile.personal.portfolioUrl?.value ?? null,
    },
    experiences: profile.experiences.slice(0, 20).map((item) => ({
      role: item.role,
      company: item.company,
      start: item.start,
      end: item.current ? null : item.end,
      current: item.current,
      highlights: item.highlights.slice(0, 5).map((text) => text.slice(0, 300)),
    })),
    education: profile.education.slice(0, 10).map((item) => ({
      degree: item.degree,
      institution: item.institution,
      year: item.year,
    })),
    skills: profile.skills.slice(0, 50).map((item) => ({ name: item.name, level: item.level })),
    languages: profile.languages.slice(0, 20).map((item) => ({
      name: item.name,
      level: item.level,
    })),
    projects: profile.projects.slice(0, 10).map((item) => ({
      name: item.name,
      description: item.description,
    })),
  };
}
