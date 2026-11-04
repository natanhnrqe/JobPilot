import type { Db } from "../db/connection.js";

/**
 * Repositórios de fontes, execuções de coleta e logs de execução
 * (Seção 3.3 da especificação; Fase 2).
 */

export interface SourceRow {
  id: number;
  key: string;
  name: string;
  kind: string;
  enabled: number;
  support_state: string;
  verified_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceInsert {
  key: string;
  name: string;
  kind: string;
  supportState?: string;
  notes?: string | null;
}

/** Insere ou atualiza a fonte pela chave única; devolve o id. */
export function upsertSource(db: Db, data: SourceInsert): number {
  const now = new Date().toISOString();
  const existing = db.get<{ id: number }>(`SELECT id FROM sources WHERE key = ?`, [data.key]);
  if (existing) {
    db.run(
      `UPDATE sources SET name = ?, kind = ?, support_state = ?,
              notes = COALESCE(?, notes), verified_at = ?, updated_at = ?
        WHERE id = ?`,
      [
        data.name,
        data.kind,
        data.supportState ?? "unverified",
        data.notes ?? null,
        now,
        now,
        existing.id,
      ],
    );
    return existing.id;
  }
  const result = db.run(
    `INSERT INTO sources (key, name, kind, enabled, support_state, verified_at, notes, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [
      data.key,
      data.name,
      data.kind,
      data.supportState ?? "unverified",
      data.supportState === "verified" ? now : null,
      data.notes ?? null,
      now,
      now,
    ],
  );
  return Number(result.lastInsertRowid);
}

export function findSourceByKey(db: Db, key: string): SourceRow | undefined {
  return db.get<SourceRow>(`SELECT * FROM sources WHERE key = ?`, [key]);
}

export interface SearchRunInsert {
  trigger: string;
  startedAt: string;
}

export function insertSearchRun(db: Db, data: SearchRunInsert): number {
  const now = new Date().toISOString();
  const result = db.run(
    `INSERT INTO search_runs (trigger, started_at, status, created_at)
     VALUES (?, ?, 'running', ?)`,
    [data.trigger, data.startedAt, now],
  );
  return Number(result.lastInsertRowid);
}

export interface SearchRunFinish {
  status: "success" | "partial" | "failed" | "skipped";
  finishedAt: string;
  discovered: number;
  created: number;
  updated: number;
  duplicate: number;
  errors: number;
  summary: string;
}

export function finishSearchRun(db: Db, id: number, finish: SearchRunFinish): void {
  db.run(
    `UPDATE search_runs
        SET status = ?, finished_at = ?, discovered_count = ?, new_count = ?,
            updated_count = ?, duplicate_count = ?, error_count = ?, summary = ?
      WHERE id = ?`,
    [
      finish.status,
      finish.finishedAt,
      finish.discovered,
      finish.created,
      finish.updated,
      finish.duplicate,
      finish.errors,
      finish.summary,
      id,
    ],
  );
}

export interface SearchRunRow {
  id: number;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  discovered_count: number;
  new_count: number;
  updated_count: number;
  duplicate_count: number;
  error_count: number;
  summary: string | null;
  created_at: string;
}

export function listSearchRuns(db: Db, limit = 20): SearchRunRow[] {
  return db.all<SearchRunRow>(
    `SELECT * FROM search_runs ORDER BY started_at DESC, id DESC LIMIT ?`,
    [limit],
  );
}

export function getLastScheduledRun(db: Db): SearchRunRow | undefined {
  return db.get<SearchRunRow>(
    `SELECT * FROM search_runs WHERE trigger = 'scheduled' ORDER BY started_at DESC LIMIT 1`,
  );
}

export interface ExecutionLogInsert {
  runId?: number | null;
  jobType: string;
  level: "debug" | "info" | "warn" | "error";
  step?: string | null;
  message: string;
  meta?: Record<string, unknown> | null;
}

export function insertExecutionLog(db: Db, data: ExecutionLogInsert): void {
  db.run(
    `INSERT INTO execution_logs (run_id, job_type, level, step, message, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.runId ?? null,
      data.jobType,
      data.level,
      data.step ?? null,
      data.message,
      data.meta ? JSON.stringify(data.meta) : null,
      new Date().toISOString(),
    ],
  );
}

/** Total de logs gravados para uma execução (usado nos testes). */
export function countExecutionLogs(db: Db, runId: number): number {
  return (
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM execution_logs WHERE run_id = ?`, [runId])
      ?.n ?? 0
  );
}
