import type { Db, SqlParam } from "../db/connection.js";

/**
 * Lembretes de acompanhamento (migração 010).
 *
 * Eles são apenas lembretes locais: não enviam e-mail, não acessam portais e
 * não mudam o status da candidatura sozinhos.
 */

export const REMINDER_KINDS = ["follow_up", "deadline", "interview", "custom"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_STATUSES = ["pending", "done", "dismissed"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export interface ReminderRow {
  id: number;
  application_id: number;
  due_at: string;
  kind: string;
  message: string | null;
  status: string;
  triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderDto {
  id: number;
  applicationId: number;
  dueAt: string;
  kind: string;
  message: string | null;
  status: string;
  triggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toReminderDto(row: ReminderRow): ReminderDto {
  return {
    id: row.id,
    applicationId: row.application_id,
    dueAt: row.due_at,
    kind: row.kind,
    message: row.message,
    status: row.status,
    triggeredAt: row.triggered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function insertReminder(
  db: Db,
  data: {
    applicationId: number;
    dueAt: string;
    kind: ReminderKind;
    message?: string | null;
  },
): number {
  const now = new Date().toISOString();
  const result = db.run(
    `INSERT INTO reminders (application_id, due_at, kind, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    [data.applicationId, data.dueAt, data.kind, data.message ?? null, now, now],
  );
  return Number(result.lastInsertRowid);
}

export function getReminderRow(db: Db, id: number): ReminderRow | undefined {
  return db.get<ReminderRow>("SELECT * FROM reminders WHERE id = ?", [id]);
}

/** Lembretes de uma candidatura: pendentes primeiro (mais próximos do vencimento). */
export function listRemindersForApplication(db: Db, applicationId: number): ReminderRow[] {
  return db.all<ReminderRow>(
    `SELECT * FROM reminders
      WHERE application_id = ?
      ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
               due_at ASC,
               id DESC`,
    [applicationId],
  );
}

export function markReminderDone(db: Db, id: number, at: string): void {
  db.run(
    `UPDATE reminders
        SET status = 'done', updated_at = ?
      WHERE id = ? AND status = 'pending'`,
    [at, id],
  );
}

export interface PendingReminderRow extends ReminderRow {
  job_id: number;
  job_title: string;
  company: string | null;
  application_status: string;
}

/**
 * Pendências para o painel do dashboard: somente lembretes `pending` de
 * candidaturas e vagas ativas. Vencidos primeiro, depois os mais próximos.
 */
export function listPendingReminderRows(db: Db, nowIso: string, limit = 20): PendingReminderRow[] {
  return db.all<PendingReminderRow>(
    `SELECT r.*, a.job_id AS job_id, a.status AS application_status,
            j.title AS job_title, j.company AS company
       FROM reminders r
       JOIN applications a ON a.id = r.application_id
       JOIN jobs j ON j.id = a.job_id
      WHERE r.status = 'pending'
        AND a.deleted_at IS NULL
        AND j.deleted_at IS NULL
      ORDER BY CASE WHEN r.due_at < ? THEN 0 ELSE 1 END,
               r.due_at ASC,
               r.id ASC
      LIMIT ?`,
    [nowIso, limit],
  );
}

export function countPendingReminders(db: Db): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM reminders r
         JOIN applications a ON a.id = r.application_id
         JOIN jobs j ON j.id = a.job_id
        WHERE r.status = 'pending'
          AND a.deleted_at IS NULL
          AND j.deleted_at IS NULL`,
    )?.n ?? 0
  );
}

export function countOverdueReminders(db: Db, nowIso: string): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM reminders r
         JOIN applications a ON a.id = r.application_id
         JOIN jobs j ON j.id = a.job_id
        WHERE r.status = 'pending'
          AND r.due_at < ?
          AND a.deleted_at IS NULL
          AND j.deleted_at IS NULL`,
      [nowIso],
    )?.n ?? 0
  );
}

/** Consulta auxiliar usada em testes/rotinas: lembretes vencidos ainda pendentes. */
export function listOverdueReminderRows(db: Db, nowIso: string, limit = 100): ReminderRow[] {
  const params: SqlParam[] = [nowIso, limit];
  return db.all<ReminderRow>(
    `SELECT * FROM reminders
      WHERE status = 'pending' AND due_at < ?
      ORDER BY due_at ASC
      LIMIT ?`,
    params,
  );
}
