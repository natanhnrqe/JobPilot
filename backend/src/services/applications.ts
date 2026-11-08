import {
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from "../domain/errors.js";
import {
  allowedApplicationTransitions,
  canTransitionApplication,
  type ApplicationStatus,
} from "../domain/statuses.js";
import {
  countApplicationsByStatus,
  getApplicationByJobId,
  getApplicationRow,
  insertApplication,
  listApplicationRows,
  restoreApplicationRow,
  softDeleteApplication,
  updateApplicationRow,
  type ApplicationFilters,
  type ApplicationListItem,
  type ApplicationRow,
} from "../repositories/applications.js";
import { getJobRow } from "../repositories/jobs.js";
import { listApplicationEvents, recordEvent } from "../repositories/events.js";
import type { ServiceContext } from "./context.js";
import { toApplicationDto, type ApplicationDto } from "./jobs.js";

export { toApplicationDto };
export type { ApplicationDto };

/**
 * Data de envio (`applied_at`): aceita "YYYY-MM-DD" ou ISO-8601 completo.
 * Só pode ser definida quando o status é ou passa a ser "sent" (envio
 * declarado manualmente pelo usuário — nunca inferido pelo sistema).
 */
export function normalizeAppliedAt(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Data de envio inválida: "${value}".`);
  }
  return parsed.toISOString();
}

export function createApplication(ctx: ServiceContext, jobId: number): ApplicationDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const job = getJobRow(db, jobId);
    if (!job) throw new NotFoundError(`Vaga ${jobId} não encontrada.`);

    const existing = getApplicationByJobId(db, jobId, true);
    if (existing) {
      throw new ConflictError(
        existing.deleted_at
          ? "Esta vaga já possui uma candidatura excluída; restaure-a em vez de criar outra."
          : "Esta vaga já possui uma candidatura.",
        { applicationId: existing.id },
      );
    }

    const now = new Date().toISOString();
    const id = insertApplication(db, {
      jobId,
      status: "preparing",
      statusChangedAt: now,
    });
    recordEvent(db, {
      jobId,
      applicationId: id,
      type: "application.created",
      toValue: "preparing",
      message: "Candidatura iniciada",
    });
    return toApplicationDto(getApplicationRow(db, id)!);
  });
}

export interface UpdateApplicationInput {
  status?: ApplicationStatus;
  appliedAt?: string | null;
}

export function updateApplication(
  ctx: ServiceContext,
  id: number,
  input: UpdateApplicationInput,
): ApplicationDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const row = getApplicationRow(db, id);
    if (!row) throw new NotFoundError(`Candidatura ${id} não encontrada.`);

    const hasStatus = input.status !== undefined && input.status !== row.status;
    const hasAppliedAt = input.appliedAt !== undefined;

    if (!hasStatus && !hasAppliedAt) {
      throw new ValidationError("Informe um campo para atualizar (status ou appliedAt).");
    }

    let newStatus: ApplicationStatus | undefined;
    let appliedAt: string | null | undefined;

    if (hasStatus) {
      const from = row.status as ApplicationStatus;
      const to = input.status!;
      if (!canTransitionApplication(from, to)) {
        throw new InvalidTransitionError(
          "candidatura",
          row.status,
          to,
          allowedApplicationTransitions(from),
        );
      }
      newStatus = to;
    }

    const effectiveStatus = newStatus ?? (row.status as ApplicationStatus);

    if (hasAppliedAt) {
      // A data de envio só existe no contexto de "sent".
      if (effectiveStatus !== "sent") {
        throw new ValidationError(
          'A data de envio (appliedAt) só pode ser definida quando a candidatura está ou passa a estar com status "sent".',
        );
      }
      appliedAt = normalizeAppliedAt(input.appliedAt);
    }

    if (effectiveStatus === "sent") {
      // Envio declarado: a data é obrigatória. Se não foi informada, usa "agora".
      if (!hasAppliedAt) {
        appliedAt = new Date().toISOString();
      } else if (appliedAt === null) {
        throw new ValidationError(
          'Uma candidatura com status "sent" precisa de data de envio (appliedAt).',
        );
      }
    }

    const now = new Date().toISOString();
    updateApplicationRow(db, id, {
      status: newStatus,
      statusChangedAt: newStatus ? now : undefined,
      appliedAt,
    });

    if (newStatus) {
      recordEvent(db, {
        jobId: row.job_id,
        applicationId: id,
        type: "application.status_changed",
        fromValue: row.status,
        toValue: newStatus,
        ...(newStatus === "sent" ? { message: "Envio declarado pelo usuário" } : {}),
      });
    }

    return toApplicationDto(getApplicationRow(db, id)!);
  });
}

/**
 * Envio declarado pelo usuário (Fase 4 — candidatura assistida).
 *
 * Garante que existe uma candidatura para a vaga e a marca como `sent`,
 * gravando `applied_at`. O JobPilot **não** envia nada sozinho: a chamada só
 * acontece quando a pessoa confirma, na interface, que já clicou em enviar.
 */
export function markApplicationSent(
  ctx: ServiceContext,
  jobId: number,
  appliedAt?: string | null,
): ApplicationDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const job = getJobRow(db, jobId);
    if (!job) throw new NotFoundError(`Vaga ${jobId} não encontrada.`);

    const now = new Date().toISOString();
    let row = getApplicationByJobId(db, jobId);
    if (!row) {
      const id = insertApplication(db, { jobId, status: "preparing", statusChangedAt: now });
      recordEvent(db, {
        jobId,
        applicationId: id,
        type: "application.created",
        toValue: "preparing",
        message: "Candidatura iniciada",
      });
      row = getApplicationRow(db, id)!;
    }

    if (row.deleted_at) {
      throw new ConflictError(
        "A candidatura desta vaga está excluída; restaure-a antes de marcar como enviada.",
      );
    }
    if (row.status === "sent") return toApplicationDto(row);

    const from = row.status as ApplicationStatus;
    if (!canTransitionApplication(from, "sent")) {
      throw new InvalidTransitionError(
        "candidatura",
        row.status,
        "sent",
        allowedApplicationTransitions(from),
      );
    }

    const at = normalizeAppliedAt(appliedAt) ?? now;
    updateApplicationRow(db, row.id, { status: "sent", statusChangedAt: now, appliedAt: at });
    recordEvent(db, {
      jobId,
      applicationId: row.id,
      type: "application.status_changed",
      fromValue: row.status,
      toValue: "sent",
      message: "Envio declarado pelo usuário",
    });
    return toApplicationDto(getApplicationRow(db, row.id)!);
  });
}

export function deleteApplication(ctx: ServiceContext, id: number): { deleted: true } {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const row = getApplicationRow(db, id);
    if (!row) throw new NotFoundError(`Candidatura ${id} não encontrada.`);
    softDeleteApplication(db, id, new Date().toISOString());
    recordEvent(db, {
      jobId: row.job_id,
      applicationId: id,
      type: "application.deleted",
    });
    return { deleted: true as const };
  });
}

export function restoreApplication(ctx: ServiceContext, id: number): ApplicationDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const row = getApplicationRow(db, id, true);
    if (!row) throw new NotFoundError(`Candidatura ${id} não encontrada.`);
    if (!row.deleted_at) throw new ConflictError("A candidatura não está excluída.");
    const job = getJobRow(db, row.job_id, true);
    if (job?.deleted_at) {
      throw new ConflictError("A vaga desta candidatura está excluída; restaure a vaga primeiro.");
    }
    restoreApplicationRow(db, id, new Date().toISOString());
    recordEvent(db, {
      jobId: row.job_id,
      applicationId: id,
      type: "application.restored",
    });
    return toApplicationDto(getApplicationRow(db, id)!);
  });
}

export interface ApplicationDetailDto extends ApplicationDto {
  job: {
    id: number;
    title: string;
    company: string | null;
    status: string;
    workMode: string;
    contractType: string;
    sourceUrl: string | null;
  };
  notes: Array<{ id: number; body: string; createdAt: string; updatedAt: string }>;
  events: ReturnType<typeof listApplicationEvents>;
}

export function getApplicationDetail(ctx: ServiceContext, id: number): ApplicationDetailDto {
  const db = ctx.holder.get();
  const row = getApplicationRow(db, id);
  if (!row) throw new NotFoundError(`Candidatura ${id} não encontrada.`);
  const job = getJobRow(db, row.job_id);
  if (!job) throw new NotFoundError(`Vaga ${row.job_id} não encontrada.`);
  const notes = listApplicationNotes(db, id);
  return {
    ...toApplicationDto(row),
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      status: job.status,
      workMode: job.work_mode,
      contractType: job.contract_type,
      sourceUrl: job.source_url,
    },
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    })),
    events: listApplicationEvents(db, id),
  };
}

function listApplicationNotes(db: import("../db/connection.js").Db, applicationId: number) {
  return db.all<{
    id: number;
    body: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT n.id, n.body, n.created_at, n.updated_at
     FROM notes n
     JOIN applications a ON a.id = n.application_id
     WHERE n.application_id = ? AND n.deleted_at IS NULL
     ORDER BY n.created_at DESC, n.id DESC`,
    [applicationId],
  );
}

export function listApplications(ctx: ServiceContext, filters: ApplicationFilters) {
  const db = ctx.holder.get();
  const { rows, total } = listApplicationRows(db, filters);
  const items = rows.map((row: ApplicationListItem) => ({
    ...toApplicationDto(row as ApplicationRow),
    jobTitle: row.job_title,
    company: row.company,
    jobStatus: row.job_status,
  }));
  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

export function dashboardApplicationStats(ctx: ServiceContext) {
  const db = ctx.holder.get();
  const counts = countApplicationsByStatus(db);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  return {
    total: counts.reduce((acc, c) => acc + c.n, 0),
    byStatus,
  };
}
