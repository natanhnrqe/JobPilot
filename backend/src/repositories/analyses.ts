import type { Db } from "../db/connection.js";
import type {
  AnalysisConfidence,
  AnalysisEvidence,
  AnalysisGap,
  AnalysisRequirement,
  AnalysisRationale,
  GapSeverity,
  JobAnalysisData,
  RequirementKind,
  RequirementMatch,
} from "../domain/analysis.js";

/**
 * Histórico de análises de compatibilidade (migração 006).
 *
 * Cada análise é imutável: re-analisar cria uma nova linha com `version`
 * incremental. A leitura falha aberto (listas vazias/valores padrão) para
 * nunca quebrar o detalhe da vaga por causa de um JSON corrompido.
 */

export interface AnalysisRow {
  id: number;
  job_id: number;
  version: number;
  model: string;
  prompt_version: string;
  score: number;
  summary: string;
  rationale_json: string;
  requirements_json: string;
  gaps_json: string;
  unknowns_json: string;
  recommend_apply: number;
  confidence: string;
  raw_json: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export interface JobAnalysisDto {
  id: number;
  jobId: number;
  version: number;
  model: string;
  promptVersion: string;
  score: number;
  summary: string;
  rationale: AnalysisRationale[];
  requirements: AnalysisRequirement[];
  gaps: AnalysisGap[];
  unknowns: string[];
  recommendApply: boolean;
  confidence: AnalysisConfidence;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

export interface AnalysisInsert {
  jobId: number;
  model: string;
  promptVersion: string;
  data: JobAnalysisData;
  rawJson: string;
  tokensIn?: number;
  tokensOut?: number;
}

/**
 * Insere uma nova versão de forma atômica: `MAX(version)+1` é calculado na
 * própria instrução, dentro da transação do chamador. O índice único
 * (job_id, version) impede duas versões iguais em caso de concorrência.
 */
export function insertAnalysis(db: Db, input: AnalysisInsert): AnalysisRow {
  const now = new Date().toISOString();
  const result = db.run(
    `INSERT INTO ai_analyses
       (job_id, version, model, prompt_version, score, summary, rationale_json,
        requirements_json, gaps_json, unknowns_json, recommend_apply, confidence,
        raw_json, tokens_in, tokens_out, created_at)
     SELECT ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM ai_analyses WHERE job_id = ?`,
    [
      input.jobId,
      input.model,
      input.promptVersion,
      input.data.score,
      input.data.summary,
      JSON.stringify(input.data.rationale),
      JSON.stringify(input.data.requirements),
      JSON.stringify(input.data.gaps),
      JSON.stringify(input.data.unknowns),
      input.data.recommendApply ? 1 : 0,
      input.data.confidence,
      input.rawJson,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
      now,
      input.jobId,
    ],
  );

  const row = db.get<AnalysisRow>("SELECT * FROM ai_analyses WHERE id = ?", [
    Number(result.lastInsertRowid),
  ]);
  if (!row) throw new Error("Falha ao ler a análise recém-gravada.");
  return row;
}

/** Análises da vaga, mais recentes primeiro. */
export function listAnalyses(db: Db, jobId: number, limit = 20): AnalysisRow[] {
  return db.all<AnalysisRow>(
    `SELECT * FROM ai_analyses WHERE job_id = ?
      ORDER BY version DESC LIMIT ?`,
    [jobId, limit],
  );
}

export function toAnalysisDto(row: AnalysisRow): JobAnalysisDto {
  return {
    id: row.id,
    jobId: row.job_id,
    version: row.version,
    model: row.model,
    promptVersion: row.prompt_version,
    score: row.score,
    summary: row.summary,
    rationale: parseArray<AnalysisRationale>(row.rationale_json, isRationale),
    requirements: parseArray<AnalysisRequirement>(row.requirements_json, isRequirement),
    gaps: parseArray<AnalysisGap>(row.gaps_json, isGap),
    unknowns: parseArray<string>(
      row.unknowns_json,
      (item): item is string => typeof item === "string",
    ),
    recommendApply: row.recommend_apply === 1,
    confidence: isConfidence(row.confidence) ? row.confidence : "low",
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    createdAt: row.created_at,
  };
}

function parseArray<T>(raw: string, guard: (value: unknown) => value is T): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(guard) : [];
  } catch {
    return [];
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRationale(value: unknown): value is AnalysisRationale {
  return (
    isObject(value) &&
    typeof value.point === "string" &&
    isEvidence(value.evidence) &&
    typeof value.quote === "string"
  );
}

function isRequirement(value: unknown): value is AnalysisRequirement {
  return (
    isObject(value) &&
    typeof value.text === "string" &&
    isRequirementKind(value.kind) &&
    isRequirementMatch(value.match)
  );
}

function isGap(value: unknown): value is AnalysisGap {
  return isObject(value) && typeof value.text === "string" && isGapSeverity(value.severity);
}

function isEvidence(value: unknown): value is AnalysisEvidence {
  return value === "cv" || value === "job";
}

function isRequirementKind(value: unknown): value is RequirementKind {
  return value === "required" || value === "nice_to_have";
}

function isRequirementMatch(value: unknown): value is RequirementMatch {
  return value === "matched" || value === "missing" || value === "unknown";
}

function isGapSeverity(value: unknown): value is GapSeverity {
  return value === "blocker" || value === "minor";
}

function isConfidence(value: unknown): value is AnalysisConfidence {
  return value === "low" || value === "medium" || value === "high";
}
