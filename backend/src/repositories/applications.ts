import type { Db, SqlParam } from "../db/connection.js";
import type { ApplicationStatus } from "../domain/statuses.js";

export interface ApplicationRow {
  id: number;
  job_id: number;
  status: string;
  status_changed_at: string;
  applied_at: string | null;
  /** Portal detectado no momento do envio declarado (migração 008). */
  portal_key: string | null;
  /** Link de evidência do envio declarado (migração 008). */
  evidence_url: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function insertApplication(
  db: Db,
  data: {
    jobId: number;
    status: ApplicationStatus;
    statusChangedAt: string;
    appliedAt?: string | null;
    portalKey?: string | null;
    evidenceUrl?: string | null;
  },
): number {
  const now = new Date().toISOString();
  const result = db.run(
    `INSERT INTO applications
       (job_id, status, status_changed_at, applied_at, portal_key, evidence_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.jobId,
      data.status,
      data.statusChangedAt,
      data.appliedAt ?? null,
      data.portalKey ?? null,
      data.evidenceUrl ?? null,
      now,
      now,
    ],
  );
  return Number(result.lastInsertRowid);
}

export function getApplicationRow(
  db: Db,
  id: number,
  includeDeleted = false,
): ApplicationRow | undefined {
  return db.get<ApplicationRow>(
    `SELECT * FROM applications WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
    [id],
  );
}

export function getApplicationByJobId(
  db: Db,
  jobId: number,
  includeDeleted = false,
): ApplicationRow | undefined {
  return db.get<ApplicationRow>(
    `SELECT * FROM applications WHERE job_id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
    [jobId],
  );
}

export interface ApplicationUpdate {
  status?: ApplicationStatus;
  statusChangedAt?: string;
  appliedAt?: string | null;
  portalKey?: string | null;
  evidenceUrl?: string | null;
}

export function updateApplicationRow(db: Db, id: number, patch: ApplicationUpdate): void {
  const sets: string[] = [];
  const params: SqlParam[] = [];

  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.statusChangedAt !== undefined) {
    sets.push("status_changed_at = ?");
    params.push(patch.statusChangedAt);
  }
  if (patch.appliedAt !== undefined) {
    sets.push("applied_at = ?");
    params.push(patch.appliedAt);
  }
  if (patch.portalKey !== undefined) {
    sets.push("portal_key = ?");
    params.push(patch.portalKey);
  }
  if (patch.evidenceUrl !== undefined) {
    sets.push("evidence_url = ?");
    params.push(patch.evidenceUrl);
  }
  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  db.run(`UPDATE applications SET ${sets.join(", ")} WHERE id = ?`, params);
}

export function softDeleteApplication(db: Db, id: number, at: string): void {
  db.run(`UPDATE applications SET deleted_at = ?, updated_at = ? WHERE id = ?`, [at, at, id]);
}

export function restoreApplicationRow(db: Db, id: number, at: string): void {
  db.run(`UPDATE applications SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [at, id]);
}

export interface ApplicationListItem extends ApplicationRow {
  job_title: string;
  company: string | null;
  job_status: string;
}

export interface ApplicationFilters {
  status?: string;
  q?: string;
  includeDeleted?: boolean;
  page: number;
  pageSize: number;
}

export function listApplicationRows(
  db: Db,
  filters: ApplicationFilters,
): { rows: ApplicationListItem[]; total: number } {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (!filters.includeDeleted) where.push("a.deleted_at IS NULL");
  if (filters.status) {
    where.push("a.status = ?");
    params.push(filters.status);
  }
  if (filters.q) {
    where.push("(LOWER(j.title) LIKE ? OR LOWER(COALESCE(j.company, '')) LIKE ?)");
    const like = `%${filters.q.toLowerCase()}%`;
    params.push(like, like);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (filters.page - 1) * filters.pageSize;

  const totalRow = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id ${whereSql}`,
    params,
  );
  const rows = db.all<ApplicationListItem>(
    `SELECT a.*, j.title AS job_title, j.company AS company, j.status AS job_status
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     ${whereSql}
     ORDER BY a.updated_at DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    [...params, filters.pageSize, offset],
  );

  return { rows, total: totalRow?.n ?? 0 };
}

export function countApplicationsByStatus(db: Db): Array<{ status: string; n: number }> {
  return db.all<{ status: string; n: number }>(
    `SELECT a.status, COUNT(*) AS n
     FROM applications a
     JOIN jobs j ON j.id = a.job_id AND j.deleted_at IS NULL
     WHERE a.deleted_at IS NULL
     GROUP BY a.status`,
  );
}
