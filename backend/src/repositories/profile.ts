import type { Db } from "../db/connection.js";
import {
  emptyProfile,
  emptyProfilePreferences,
  isProfileWorkMode,
  normalizeContractTypes,
  type ProfileAnswers,
  type ProfileData,
  type ProfilePreferences,
} from "../domain/profile.js";

/**
 * Perfil profissional (migração 005). Linha única (`id = 1`).
 *
 * O arquivo original do CV não é armazenado (`cv_file_path` fica NULL): por
 * privacidade guardamos apenas `raw_cv_text`. A leitura falha aberta para um
 * perfil vazio se o JSON estiver corrompido — a UI permite corrigir e salvar.
 */
export interface StoredProfile {
  version: number;
  rawCvText: string | null;
  profile: ProfileData;
  preferences: ProfilePreferences;
  answers: ProfileAnswers;
  hasProfile: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ProfileRow {
  version: number;
  raw_cv_text: string | null;
  extracted_json: string;
  preferences_json: string;
  answers_json: string;
  created_at: string;
  updated_at: string;
}

export function getProfile(db: Db): StoredProfile {
  const row = db.get<ProfileRow>(
    `SELECT version, raw_cv_text, extracted_json, preferences_json, answers_json,
            created_at, updated_at
       FROM profile WHERE id = 1`,
  );

  if (!row) {
    return {
      version: 0,
      rawCvText: null,
      profile: emptyProfile(),
      preferences: emptyProfilePreferences(),
      answers: {},
      hasProfile: false,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    version: row.version,
    rawCvText: row.raw_cv_text,
    profile: parseProfile(row.extracted_json),
    preferences: parsePreferences(row.preferences_json),
    answers: parseAnswers(row.answers_json),
    hasProfile: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SaveProfileInput {
  /** Ausente = preserva o texto do CV já salvo (edição manual). */
  rawCvText?: string | null;
  profile: ProfileData;
  preferences: ProfilePreferences;
  answers: ProfileAnswers;
}

/** Grava o perfil revisado e incrementa a versão. Nunca grava o arquivo do CV. */
export function saveProfile(db: Db, input: SaveProfileInput): StoredProfile {
  const current = getProfile(db);
  const now = new Date().toISOString();
  const version = current.hasProfile ? current.version + 1 : 1;
  const rawCvText = input.rawCvText === undefined ? current.rawCvText : input.rawCvText;
  const createdAt = current.createdAt ?? now;

  db.run(
    `INSERT INTO profile
       (id, version, raw_cv_text, cv_file_path, extracted_json, preferences_json,
        answers_json, created_at, updated_at)
     VALUES (1, ?, ?, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       version = excluded.version,
       raw_cv_text = excluded.raw_cv_text,
       cv_file_path = NULL,
       extracted_json = excluded.extracted_json,
       preferences_json = excluded.preferences_json,
       answers_json = excluded.answers_json,
       updated_at = excluded.updated_at`,
    [
      version,
      rawCvText,
      JSON.stringify(input.profile),
      JSON.stringify(input.preferences),
      JSON.stringify(input.answers),
      createdAt,
      now,
    ],
  );

  return getProfile(db);
}

function parseProfile(raw: string): ProfileData {
  const parsed = parseObject(raw);
  if (!parsed) return emptyProfile();

  const base = emptyProfile();
  const personal =
    parsed.personal && typeof parsed.personal === "object" && !Array.isArray(parsed.personal)
      ? { ...base.personal, ...(parsed.personal as Partial<ProfileData["personal"]>) }
      : base.personal;

  return {
    personal,
    experiences: arrayOf(parsed.experiences),
    education: arrayOf(parsed.education),
    skills: arrayOf(parsed.skills),
    languages: arrayOf(parsed.languages),
    projects: arrayOf(parsed.projects),
    inferred: arrayOf(parsed.inferred),
  };
}

function parsePreferences(raw: string): ProfilePreferences {
  const parsed = parseObject(raw);
  if (!parsed) return emptyProfilePreferences();

  return {
    desiredRoles: stringArray(parsed.desiredRoles),
    workModes: Array.isArray(parsed.workModes) ? parsed.workModes.filter(isProfileWorkMode) : [],
    locations: stringArray(parsed.locations),
    salaryExpectation:
      typeof parsed.salaryExpectation === "string" ? parsed.salaryExpectation : null,
    contractTypes: Array.isArray(parsed.contractTypes)
      ? normalizeContractTypes(parsed.contractTypes)
      : [],
  };
}

function parseAnswers(raw: string): ProfileAnswers {
  const parsed = parseObject(raw);
  if (!parsed) return {};
  const answers: ProfileAnswers = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && key.trim() !== "") answers[key] = value;
  }
  return answers;
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
