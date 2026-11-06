import fs from "node:fs";
import path from "node:path";
import { NotFoundError } from "../domain/errors.js";
import {
  getSearchRun,
  listExecutionLogs,
  listSearchRuns,
  listSources,
  type ExecutionLogRow,
  type SearchRunRow,
  type SourceRow,
} from "../repositories/sources.js";
import type { ServiceContext } from "./context.js";

/**
 * Leitura das execuções de coleta (Seção 4.5 da especificação): histórico em
 * `search_runs`, passo a passo em `execution_logs`, fontes registradas e o
 * resumo da última execução em `data/last-run.json`.
 *
 * Somente leitura: nada aqui dispara coleta nem altera o banco.
 */

export interface ExecutionRun {
  id: number;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  /** Duração em ms quando a execução terminou; null se ainda está em andamento. */
  durationMs: number | null;
  discoveredCount: number;
  newCount: number;
  updatedCount: number;
  duplicateCount: number;
  errorCount: number;
  summary: string | null;
}

export interface ExecutionLog {
  id: number;
  level: string;
  step: string | null;
  message: string;
  /** `meta_json` interpretado; null quando ausente ou inválido (nunca quebra a resposta). */
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface SourceInfo {
  id: number;
  key: string;
  name: string;
  kind: string;
  enabled: boolean;
  supportState: string;
  verifiedAt: string | null;
  updatedAt: string;
}

export interface ExecutionList {
  runs: ExecutionRun[];
  /** Conteúdo de `data/last-run.json` (null se ausente ou ilegível). */
  lastRun: Record<string, unknown> | null;
}

export interface ExecutionDetail {
  run: ExecutionRun;
  logs: ExecutionLog[];
}

export function listExecutions(ctx: ServiceContext, limit = 20): ExecutionList {
  const db = ctx.holder.get();
  return {
    runs: listSearchRuns(db, limit).map(toExecutionRun),
    lastRun: readLastRunFile(ctx),
  };
}

export function getExecution(ctx: ServiceContext, id: number): ExecutionDetail {
  const db = ctx.holder.get();
  const row = getSearchRun(db, id);
  if (!row) throw new NotFoundError("Execução não encontrada.");
  return {
    run: toExecutionRun(row),
    logs: listExecutionLogs(db, id).map(toExecutionLog),
  };
}

export function listSourceInfos(ctx: ServiceContext): SourceInfo[] {
  return listSources(ctx.holder.get()).map(toSourceInfo);
}

function toExecutionRun(row: SearchRunRow): ExecutionRun {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: durationMs(row.started_at, row.finished_at),
    discoveredCount: row.discovered_count,
    newCount: row.new_count,
    updatedCount: row.updated_count,
    duplicateCount: row.duplicate_count,
    errorCount: row.error_count,
    summary: row.summary,
  };
}

function toExecutionLog(row: ExecutionLogRow): ExecutionLog {
  return {
    id: row.id,
    level: row.level,
    step: row.step,
    message: row.message,
    meta: parseMeta(row.meta_json),
    createdAt: row.created_at,
  };
}

function toSourceInfo(row: SourceRow): SourceInfo {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled !== 0,
    supportState: row.support_state,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

function durationMs(startedAt: string, finishedAt: string | null): number | null {
  if (!finishedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function parseMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Lê o resumo gravado pela coleta; arquivo ausente ou inválido vira null. */
function readLastRunFile(ctx: ServiceContext): Record<string, unknown> | null {
  const file = path.join(ctx.config.dataDir, "last-run.json");
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
