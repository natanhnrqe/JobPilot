import { ConflictError, NotFoundError, ValidationError } from "../domain/errors.js";
import { getApplicationRow } from "../repositories/applications.js";
import { recordEvent } from "../repositories/events.js";
import {
  countOverdueReminders,
  countPendingReminders,
  getReminderRow,
  insertReminder,
  listPendingReminderRows,
  listRemindersForApplication,
  markReminderDone,
  toReminderDto,
  type ReminderDto,
} from "../repositories/reminders.js";
import type { ServiceContext } from "./context.js";

/**
 * Data do lembrete: aceita "YYYY-MM-DD" (vence no fim do dia local) ou
 * ISO-8601 completo. O valor é sempre normalizado para ISO UTC no banco.
 */
export function normalizeDueAt(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new ValidationError("Informe a data do lembrete (dueAt).");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    // Fim do dia local: o lembrete fica pendente durante todo o dia escolhido
    // e só é considerado vencido a partir do dia seguinte.
    const endOfDay = new Date(`${trimmed}T23:59:59.999`);
    if (Number.isNaN(endOfDay.getTime())) {
      throw new ValidationError(`Data de lembrete inválida: "${value}".`);
    }
    return endOfDay.toISOString();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Data de lembrete inválida: "${value}".`);
  }
  return parsed.toISOString();
}

export interface CreateFollowUpInput {
  dueAt: string;
  message?: string | null;
}

/**
 * Agenda um acompanhamento para a candidatura. Não envia nada ao portal e não
 * altera o status: apenas cria uma pendência local.
 */
export function createFollowUp(
  ctx: ServiceContext,
  applicationId: number,
  input: CreateFollowUpInput,
): ReminderDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const application = getApplicationRow(db, applicationId);
    if (!application) throw new NotFoundError(`Candidatura ${applicationId} não encontrada.`);

    const dueAt = normalizeDueAt(input.dueAt);
    const message = input.message?.trim() ? input.message.trim() : null;

    const id = insertReminder(db, {
      applicationId,
      dueAt,
      kind: "follow_up",
      message,
    });

    recordEvent(db, {
      jobId: application.job_id,
      applicationId,
      type: "application.reminder_created",
      toValue: "pending",
      message: message ?? "Acompanhamento agendado",
      meta: { reminderId: id, dueAt, kind: "follow_up" },
    });

    return toReminderDto(getReminderRow(db, id)!);
  });
}

/**
 * Marca um lembrete como concluído. Idempotente quando já está concluído;
 * lembretes dispensados não podem ser concluídos.
 */
export function completeReminder(
  ctx: ServiceContext,
  applicationId: number,
  reminderId: number,
): ReminderDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const application = getApplicationRow(db, applicationId);
    if (!application) throw new NotFoundError(`Candidatura ${applicationId} não encontrada.`);

    const reminder = getReminderRow(db, reminderId);
    if (!reminder || reminder.application_id !== applicationId) {
      throw new NotFoundError(
        `Lembrete ${reminderId} não encontrado para a candidatura ${applicationId}.`,
      );
    }

    if (reminder.status === "done") return toReminderDto(reminder);
    if (reminder.status !== "pending") {
      throw new ConflictError("Somente lembretes pendentes podem ser concluídos.", {
        status: reminder.status,
      });
    }

    markReminderDone(db, reminderId, new Date().toISOString());
    recordEvent(db, {
      jobId: application.job_id,
      applicationId,
      type: "application.reminder_completed",
      fromValue: "pending",
      toValue: "done",
      message: reminder.message ?? "Acompanhamento concluído",
      meta: { reminderId },
    });

    return toReminderDto(getReminderRow(db, reminderId)!);
  });
}

export function listApplicationReminders(
  ctx: ServiceContext,
  applicationId: number,
): ReminderDto[] {
  return listRemindersForApplication(ctx.holder.get(), applicationId).map(toReminderDto);
}

export interface PendingReminderDto extends ReminderDto {
  overdue: boolean;
  jobId: number;
  jobTitle: string;
  company: string | null;
  applicationStatus: string;
}

export interface ReminderSummary {
  pending: number;
  overdue: number;
  items: PendingReminderDto[];
}

/** Painel de pendências do dashboard (nada simulado: vem do banco real). */
export function dashboardReminderStats(ctx: ServiceContext, limit = 20): ReminderSummary {
  const db = ctx.holder.get();
  const now = new Date().toISOString();
  const items = listPendingReminderRows(db, now, limit).map((row) => ({
    ...toReminderDto(row),
    overdue: row.due_at < now,
    jobId: row.job_id,
    jobTitle: row.job_title,
    company: row.company,
    applicationStatus: row.application_status,
  }));

  return {
    pending: countPendingReminders(db),
    overdue: countOverdueReminders(db, now),
    items,
  };
}
