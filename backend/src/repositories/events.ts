import type { Db } from "../db/connection.js";

export type EventType =
  | "job.created"
  | "job.status_changed"
  | "job.deleted"
  | "job.restored"
  | "application.created"
  | "application.status_changed"
  | "application.deleted"
  | "application.restored"
  | "note.added";

export interface EventInput {
  jobId?: number | null;
  applicationId?: number | null;
  type: EventType;
  actor?: "user" | "system";
  fromValue?: string | null;
  toValue?: string | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface EventRow {
  id: number;
  job_id: number | null;
  application_id: number | null;
  type: string;
  actor: string;
  from_value: string | null;
  to_value: string | null;
  message: string | null;
  meta_json: string | null;
  created_at: string;
}

/**
 * Insere um evento no histórico. Deve ser chamado DENTRO da transação
 * da mudança que o origina (Seção 5.4 da especificação).
 */
export function recordEvent(db: Db, input: EventInput): number {
  const result = db.run(
    `INSERT INTO events (job_id, application_id, type, actor, from_value, to_value, message, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.jobId ?? null,
      input.applicationId ?? null,
      input.type,
      input.actor ?? "user",
      input.fromValue ?? null,
      input.toValue ?? null,
      input.message ?? null,
      input.meta ? JSON.stringify(input.meta) : null,
      new Date().toISOString(),
    ],
  );
  return Number(result.lastInsertRowid);
}

export interface EventDto {
  id: number;
  jobId: number | null;
  applicationId: number | null;
  type: string;
  actor: string;
  from: string | null;
  to: string | null;
  message: string | null;
  createdAt: string;
}

function toDto(row: EventRow): EventDto {
  return {
    id: row.id,
    jobId: row.job_id,
    applicationId: row.application_id,
    type: row.type,
    actor: row.actor,
    from: row.from_value,
    to: row.to_value,
    message: row.message,
    createdAt: row.created_at,
  };
}

/** Histórico da vaga (mais recentes primeiro). */
export function listJobEvents(db: Db, jobId: number, limit = 100): EventDto[] {
  return db
    .all<EventRow>(
      `SELECT * FROM events WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [jobId, limit],
    )
    .map(toDto);
}

/** Histórico da candidatura (mais recentes primeiro). */
export function listApplicationEvents(db: Db, applicationId: number, limit = 100): EventDto[] {
  return db
    .all<EventRow>(
      `SELECT * FROM events WHERE application_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [applicationId, limit],
    )
    .map(toDto);
}

export interface ActivityItem extends EventDto {
  jobTitle: string | null;
  company: string | null;
}

/** Feed de atividade recente para o dashboard. */
export function listRecentEvents(db: Db, limit: number): ActivityItem[] {
  return db
    .all<EventRow & { job_title: string | null; company: string | null }>(
      `SELECT e.*, j.title AS job_title, j.company AS company
       FROM events e
       LEFT JOIN jobs j ON j.id = e.job_id
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ?`,
      [limit],
    )
    .map((row) => ({
      ...toDto(row),
      jobTitle: row.job_title,
      company: row.company,
    }));
}
