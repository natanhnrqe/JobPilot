import { NotFoundError, ConflictError, InvalidTransitionError } from "../domain/errors.js";
import { allowedJobTransitions, canTransitionJob, type JobStatus } from "../domain/statuses.js";
import type { Db } from "../db/connection.js";
import {
  countDeletedJobs,
  countJobsByStatus,
  getJobRow,
  insertJob,
  listJobRows,
  restoreJobRow,
  softDeleteJob,
  updateJobRow,
  type JobFilters,
  type JobRow,
} from "../repositories/jobs.js";
import {
  getApplicationByJobId,
  restoreApplicationRow,
  softDeleteApplication,
  type ApplicationRow,
} from "../repositories/applications.js";
import { listJobEvents, recordEvent } from "../repositories/events.js";
import { listNoteRows } from "../repositories/notes.js";
import type { ServiceContext } from "./context.js";

export interface JobDto {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  workMode: string;
  contractType: string;
  salaryText: string | null;
  descriptionText: string | null;
  sourceUrl: string | null;
  discoveredAt: string;
  status: JobStatus;
  statusChangedAt: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobDetailDto extends JobDto {
  application: ApplicationDto | null;
  notes: NoteDto[];
  events: ReturnType<typeof listJobEvents>;
}

export interface ApplicationDto {
  id: number;
  jobId: number;
  status: string;
  statusChangedAt: string;
  appliedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDto {
  id: number;
  jobId: number;
  applicationId: number | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export function toJobDto(row: JobRow): JobDto {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    workMode: row.work_mode,
    contractType: row.contract_type,
    salaryText: row.salary_text,
    descriptionText: row.description_text,
    sourceUrl: row.source_url,
    discoveredAt: row.discovered_at,
    status: row.status as JobStatus,
    statusChangedAt: row.status_changed_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toApplicationDto(row: ApplicationRow): ApplicationDto {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    statusChangedAt: row.status_changed_at,
    appliedAt: row.applied_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toNoteDto(row: {
  id: number;
  job_id: number;
  application_id: number | null;
  body: string;
  created_at: string;
  updated_at: string;
}): NoteDto {
  return {
    id: row.id,
    jobId: row.job_id,
    applicationId: row.application_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireJob(db: Db, id: number, includeDeleted = false): JobRow {
  const row = getJobRow(db, id, includeDeleted);
  if (!row) throw new NotFoundError(`Vaga ${id} não encontrada.`);
  return row;
}

export function createJob(
  ctx: ServiceContext,
  input: {
    title: string;
    company?: string | null;
    location?: string | null;
    workMode?: string;
    contractType?: string;
    salaryText?: string | null;
    descriptionText?: string | null;
    sourceUrl?: string | null;
    discoveredAt?: string;
  },
): JobDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const now = new Date().toISOString();
    const id = insertJob(db, { ...input, status: "new", statusChangedAt: now });
    recordEvent(db, {
      jobId: id,
      type: "job.created",
      toValue: "new",
      message: "Vaga cadastrada",
    });
    return toJobDto(requireJob(db, id));
  });
}

export function updateJob(
  ctx: ServiceContext,
  id: number,
  patch: Partial<{
    title: string;
    company: string | null;
    location: string | null;
    workMode: string;
    contractType: string;
    salaryText: string | null;
    descriptionText: string | null;
    sourceUrl: string | null;
    discoveredAt: string;
    status: JobStatus;
  }>,
): JobDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const row = requireJob(db, id);
    const { status, ...fields } = patch;
    const hasFields = Object.keys(fields).length > 0;
    const now = new Date().toISOString();

    if (status && status !== row.status) {
      if (!canTransitionJob(row.status as JobStatus, status)) {
        throw new InvalidTransitionError(
          "vaga",
          row.status,
          status,
          allowedJobTransitions(row.status as JobStatus),
        );
      }
      updateJobRow(db, id, { ...fields, status, statusChangedAt: now });
      recordEvent(db, {
        jobId: id,
        type: "job.status_changed",
        fromValue: row.status,
        toValue: status,
      });
    } else if (hasFields) {
      updateJobRow(db, id, fields);
    }

    return toJobDto(requireJob(db, id));
  });
}

/**
 * Exclusão lógica: preserva histórico e exclusa junto a candidatura associada
 * (Seções 3.4 e 5.5 da especificação).
 */
export function deleteJob(ctx: ServiceContext, id: number): { deleted: true } {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    requireJob(db, id);
    const now = new Date().toISOString();
    softDeleteJob(db, id, now);
    recordEvent(db, { jobId: id, type: "job.deleted" });

    const app = getApplicationByJobId(db, id);
    if (app && !app.deleted_at) {
      softDeleteApplication(db, app.id, now);
      recordEvent(db, {
        jobId: id,
        applicationId: app.id,
        type: "application.deleted",
        message: "Excluída junto com a vaga",
      });
    }
    return { deleted: true as const };
  });
}

export function restoreJob(ctx: ServiceContext, id: number): JobDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const row = requireJob(db, id, true);
    if (!row.deleted_at) {
      throw new ConflictError("A vaga não está excluída.");
    }
    const now = new Date().toISOString();
    restoreJobRow(db, id, now);
    recordEvent(db, { jobId: id, type: "job.restored" });

    const app = getApplicationByJobId(db, id, true);
    if (app && app.deleted_at) {
      restoreApplicationRow(db, app.id, now);
      recordEvent(db, {
        jobId: id,
        applicationId: app.id,
        type: "application.restored",
        message: "Restaurada junto com a vaga",
      });
    }
    return toJobDto(requireJob(db, id));
  });
}

export function getJobDetail(
  ctx: ServiceContext,
  id: number,
  includeDeleted = false,
): JobDetailDto {
  const db = ctx.holder.get();
  const row = requireJob(db, id, includeDeleted);
  const application = getApplicationByJobId(db, id, true) ?? null;
  return {
    ...toJobDto(row),
    application: application ? toApplicationDto(application) : null,
    notes: listNoteRows(db, id, application?.id ?? null).map(toNoteDto),
    events: listJobEvents(db, id),
  };
}

export function listJobs(ctx: ServiceContext, filters: JobFilters) {
  const db = ctx.holder.get();
  const { rows, total } = listJobRows(db, filters);
  return { items: rows.map(toJobDto), total, page: filters.page, pageSize: filters.pageSize };
}

export function dashboardJobStats(ctx: ServiceContext) {
  const db = ctx.holder.get();
  const counts = countJobsByStatus(db);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  return {
    total: counts.reduce((acc, c) => acc + c.n, 0),
    byStatus,
    deleted: countDeletedJobs(db),
  };
}
