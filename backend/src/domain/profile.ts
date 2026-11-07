import { CONTRACT_TYPES, type ContractType } from "./contractType.js";

/**
 * Perfil profissional (Fase 3, fatia 2).
 *
 * Regras estruturais:
 * - Tudo que veio do CV carrega `sourceQuote` (trecho exato do arquivo). Itens
 *   sem citação são descartados na extração — a IA não inventa dados.
 * - `inferred` reúne conclusões da IA (ex.: tempo de experiência) e exige
 *   confirmação humana antes de ser salvo.
 * - O arquivo original do CV não é retido: só o texto extraído.
 */

export const PROFILE_WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type ProfileWorkMode = (typeof PROFILE_WORK_MODES)[number];

export const SKILL_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

/** Texto extraído do CV + trecho que o comprova. */
export interface QuotedText {
  value: string;
  sourceQuote: string;
}

export const PERSONAL_FIELDS = [
  "fullName",
  "email",
  "phone",
  "location",
  "linkedinUrl",
  "githubUrl",
  "portfolioUrl",
  "summary",
] as const;
export type PersonalField = (typeof PERSONAL_FIELDS)[number];
export type ProfilePersonal = Record<PersonalField, QuotedText | null>;

export interface ProfileExperience {
  role: string;
  company: string | null;
  /** `YYYY-MM` ou `YYYY`; null quando o CV não informa. */
  start: string | null;
  /** null pode significar "atual" (ver `current`). */
  end: string | null;
  current: boolean;
  highlights: string[];
  sourceQuote: string;
}

export interface ProfileEducation {
  degree: string;
  institution: string;
  year: string | null;
  sourceQuote: string;
}

export interface ProfileSkill {
  name: string;
  level: SkillLevel | null;
  sourceQuote: string;
}

export interface ProfileLanguage {
  name: string;
  level: string | null;
  sourceQuote: string;
}

export interface ProfileProject {
  name: string;
  url: string | null;
  description: string | null;
  sourceQuote: string;
}

/** Conclusão da IA que o usuário precisa confirmar explicitamente. */
export interface InferredItem {
  field: string;
  value: string;
  reason: string;
  confirmed: boolean;
}

export interface ProfileData {
  personal: ProfilePersonal;
  experiences: ProfileExperience[];
  education: ProfileEducation[];
  skills: ProfileSkill[];
  languages: ProfileLanguage[];
  projects: ProfileProject[];
  inferred: InferredItem[];
}

export interface ProfilePreferences {
  desiredRoles: string[];
  workModes: ProfileWorkMode[];
  locations: string[];
  salaryExpectation: string | null;
  contractTypes: ContractType[];
}

export type ProfileAnswers = Record<string, string>;

/** Perfil vazio (nenhum CV importado e nenhum dado manual). */
export function emptyProfile(): ProfileData {
  return {
    personal: {
      fullName: null,
      email: null,
      phone: null,
      location: null,
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
      summary: null,
    },
    experiences: [],
    education: [],
    skills: [],
    languages: [],
    projects: [],
    inferred: [],
  };
}

export function emptyProfilePreferences(): ProfilePreferences {
  return {
    desiredRoles: [],
    workModes: [],
    locations: [],
    salaryExpectation: null,
    contractTypes: [],
  };
}

export function isProfileWorkMode(value: unknown): value is ProfileWorkMode {
  return typeof value === "string" && (PROFILE_WORK_MODES as readonly string[]).includes(value);
}

export function isSkillLevel(value: unknown): value is SkillLevel {
  return typeof value === "string" && (SKILL_LEVELS as readonly string[]).includes(value);
}

/**
 * Normaliza datas para `YYYY-MM` (ou `YYYY` quando o mês não existe no CV).
 * Nunca completa mês/dia ausentes — isso seria inventar informação.
 */
export function normalizeMonth(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const full = /^(\d{4})-(\d{2})/.exec(text);
  if (full) return `${full[1]}-${full[2]}`;
  const year = /^(\d{4})$/.exec(text);
  if (year) return year[1] ?? null;
  return null;
}

/** Aceita `https://…`, `www.…` ou `dominio.com/…`; devolve null se não parecer URL. */
export function normalizeUrl(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/\s/.test(text)) return null;
  if (/^www\./i.test(text) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(text)) {
    return `https://${text}`;
  }
  return null;
}

/** Validação conservadora de e-mail: mantém o texto apenas se parecer um e-mail. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
}

/** Mantém apenas os tipos de contrato válidos, na ordem canônica. */
export function normalizeContractTypes(values: readonly unknown[]): ContractType[] {
  const seen = new Set<ContractType>();
  for (const value of values) {
    if (typeof value === "string" && (CONTRACT_TYPES as readonly string[]).includes(value)) {
      seen.add(value as ContractType);
    }
  }
  return CONTRACT_TYPES.filter((type) => seen.has(type));
}
