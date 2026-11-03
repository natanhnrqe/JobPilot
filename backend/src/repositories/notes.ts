import type { Db, SqlParam } from "../db/connection.js";

export interface NoteRow {
  id: number;
  job_id: number;
  application_id: number | null;
  body: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function insertNote(
  db: Db,
  data: { jobId: number; applicationId?: number | null; body: string },
): number {
  const now = new Date().toISOString();
  const result = db.run(
    `INSERT INTO notes (job_id, application_id, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [data.jobId, data.applicationId ?? null, data.body, now, now],
  );
  return Number(result.lastInsertRowid);
}

export function getNoteRow(db: Db, id: number, includeDeleted = false): NoteRow | undefined {
  return db.get<NoteRow>(
    `SELECT * FROM notes WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
    [id],
  );
}

export function updateNoteRow(db: Db, id: number, body: string): void {
  db.run(`UPDATE notes SET body = ?, updated_at = ? WHERE id = ?`, [
    body,
    new Date().toISOString(),
    id,
  ]);
}

export function softDeleteNote(db: Db, id: number): void {
  const now = new Date().toISOString();
  db.run(`UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
}

export function listNoteRows(db: Db, jobId: number, applicationId?: number | null): NoteRow[] {
  const where: string[] = ["job_id = ?", "deleted_at IS NULL"];
  const params: SqlParam[] = [jobId];
  if (applicationId !== undefined && applicationId !== null) {
    where.push("(application_id IS NULL OR application_id = ?)");
    params.push(applicationId);
  }
  return db.all<NoteRow>(
    `SELECT * FROM notes WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC`,
    params,
  );
}
