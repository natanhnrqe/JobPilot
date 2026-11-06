import type { Db, SqlParam } from "../db/connection.js";
import type { JobStatus } from "../domain/statuses.js";

export interface JobRow {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  work_mode: string;
  contract_type: string;
  /** De onde veio o tipo de contrato: source|title|user|unknown (migração 004). */
  contract_type_source: string;
  salary_text: string | null;
  description_text: string | null;
  source_url: string | null;
  /** Data de publicação informada pela fonte (nunca inferida — ver migração 002). */
  posted_at: string | null;
  /** Fonte de onde veio (null = cadastro manual/assistido — migração 003). */
  source_id: number | null;
  /** Identificador estável na fonte, quando a fonte fornece um. */
  external_id: string | null;
  discovered_at: string;
  status: string;
  status_changed_at: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobInsert {
  title: string;
  company?: string | null;
  location?: string | null;
  workMode?: string;
  contractType?: string;
  contractTypeSource?: string;
  salaryText?: string | null;
  descriptionText?: string | null;
  sourceUrl?: string | null;
  postedAt?: string | null;
  sourceId?: number | null;
  externalId?: string | null;
  discoveredAt?: string | null;
  status: JobStatus;
  statusChangedAt: string;
}

export function insertJob(db: Db, data: JobInsert): number {
  const now = new Date().toISOString();
  const contractType = data.contractType ?? "unknown";
  // Cadastro manual/assistido: o tipo veio do usuário. A coleta passa a
  // origem explicitamente ('source' ou 'title').
  const contractTypeSource =
    data.contractTypeSource ?? (contractType === "unknown" ? "unknown" : "user");

  const result = db.run(
    `INSERT INTO jobs (title, company, location, work_mode, contract_type, contract_type_source,
                       salary_text, description_text, source_url, posted_at, source_id,
                       external_id, discovered_at, status, status_changed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title,
      data.company ?? null,
      data.location ?? null,
      data.workMode ?? "unknown",
      contractType,
      contractTypeSource,
      data.salaryText ?? null,
      data.descriptionText ?? null,
      data.sourceUrl ?? null,
      data.postedAt ?? null,
      data.sourceId ?? null,
      data.externalId ?? null,
      data.discoveredAt ?? now,
      data.status,
      data.statusChangedAt,
      now,
      now,
    ],
  );
  return Number(result.lastInsertRowid);
}

/** Vaga ativa de uma fonte com aquele identificador externo (dedupe prioritário). */
export function findJobByExternalId(
  db: Db,
  sourceId: number,
  externalId: string,
): JobRow | undefined {
  return db.get<JobRow>(
    `SELECT * FROM jobs
      WHERE source_id = ? AND external_id = ? AND deleted_at IS NULL`,
    [sourceId, externalId],
  );
}

export function getJobRow(db: Db, id: number, includeDeleted = false): JobRow | undefined {
  return db.get<JobRow>(
    `SELECT * FROM jobs WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
    [id],
  );
}

export interface JobUpdate {
  title?: string;
  company?: string | null;
  location?: string | null;
  workMode?: string;
  contractType?: string;
  contractTypeSource?: string;
  salaryText?: string | null;
  descriptionText?: string | null;
  sourceUrl?: string | null;
  postedAt?: string | null;
  discoveredAt?: string;
  status?: JobStatus;
  statusChangedAt?: string;
}

export function updateJobRow(db: Db, id: number, patch: JobUpdate): void {
  const sets: string[] = [];
  const params: SqlParam[] = [];

  const map: Array<[keyof JobUpdate, string]> = [
    ["title", "title"],
    ["company", "company"],
    ["location", "location"],
    ["workMode", "work_mode"],
    ["contractType", "contract_type"],
    ["contractTypeSource", "contract_type_source"],
    ["salaryText", "salary_text"],
    ["descriptionText", "description_text"],
    ["sourceUrl", "source_url"],
    ["postedAt", "posted_at"],
    ["discoveredAt", "discovered_at"],
    ["status", "status"],
    ["statusChangedAt", "status_changed_at"],
  ];

  for (const [key, column] of map) {
    if (patch[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(patch[key] as SqlParam);
    }
  }
  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  db.run(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, params);
}

/** Exclusão lógica (soft delete). O histórico nunca é destruído (Seção 3.4). */
export function softDeleteJob(db: Db, id: number, at: string): void {
  db.run(`UPDATE jobs SET deleted_at = ?, updated_at = ? WHERE id = ?`, [at, at, id]);
}

export function restoreJobRow(db: Db, id: number, at: string): void {
  db.run(`UPDATE jobs SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [at, id]);
}

export interface JobFilters {
  status?: string;
  workMode?: string;
  contractType?: string;
  q?: string;
  includeDeleted?: boolean;
  sort?: string;
  page: number;
  pageSize: number;
}

export function listJobRows(db: Db, filters: JobFilters): { rows: JobRow[]; total: number } {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (!filters.includeDeleted) where.push("deleted_at IS NULL");
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.workMode) {
    where.push("work_mode = ?");
    params.push(filters.workMode);
  }
  if (filters.contractType) {
    where.push("contract_type = ?");
    params.push(filters.contractType);
  }
  if (filters.q) {
    where.push("(LOWER(title) LIKE ? OR LOWER(COALESCE(company, '')) LIKE ?)");
    const like = `%${filters.q.toLowerCase()}%`;
    params.push(like, like);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sortable = new Set(["discovered_at", "title", "company", "status", "created_at"]);
  const sortColumn = sortable.has(filters.sort ?? "") ? (filters.sort as string) : "discovered_at";
  const offset = (filters.page - 1) * filters.pageSize;

  const totalRow = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs ${whereSql}`, params);
  const rows = db.all<JobRow>(
    `SELECT * FROM jobs ${whereSql}
     ORDER BY ${sortColumn} DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, filters.pageSize, offset],
  );

  return { rows, total: totalRow?.n ?? 0 };
}

export interface JobStatusCount {
  status: string;
  n: number;
}

export function countJobsByStatus(db: Db): JobStatusCount[] {
  return db.all<JobStatusCount>(
    `SELECT status, COUNT(*) AS n FROM jobs WHERE deleted_at IS NULL GROUP BY status`,
  );
}

export function countDeletedJobs(db: Db): number {
  return (
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE deleted_at IS NOT NULL`)?.n ?? 0
  );
}
