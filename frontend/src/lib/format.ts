/** Rótulos e formatação em pt-BR. */

import type { ApplicationStatus, ContractType, JobStatus, WorkMode } from "../api/types";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: "Nova",
  prioritized: "Priorizada",
  discarded: "Descartada",
  closed: "Encerrada",
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  preparing: "Em preparação",
  sent: "Enviada",
  interview: "Entrevista",
  offer: "Oferta",
  rejected: "Rejeitada",
  withdrawn: "Retirada",
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: "Remoto",
  hybrid: "Híbrido",
  onsite: "Presencial",
  unknown: "Não informado",
};

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  internship: "Estágio",
  junior: "Júnior",
  mid: "Pleno",
  senior: "Sênior",
  freelance: "Freelance",
  unknown: "Não informado",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  "job.created": "Vaga cadastrada",
  "job.status_changed": "Status da vaga alterado",
  "job.deleted": "Vaga excluída",
  "job.restored": "Vaga restaurada",
  "application.created": "Candidatura iniciada",
  "application.status_changed": "Status da candidatura alterado",
  "application.deleted": "Candidatura excluída",
  "application.restored": "Candidatura restaurada",
  "note.added": "Nota adicionada",
};

/** Fuso usado para exibir datas (configurável em Configurações; padrao America/Sao_Paulo). */
let currentTimezone = "America/Sao_Paulo";

export function setTimezone(tz: string): void {
  currentTimezone = tz;
}

export function getTimezone(): string {
  return currentTimezone;
}

function format(options: Intl.DateTimeFormatOptions, iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: currentTimezone }).format(date);
  } catch {
    // fuso inválido configurado — volta para o fuso local
    return new Intl.DateTimeFormat("pt-BR", options).format(date);
  }
}

export function formatDate(iso: string | null | undefined): string {
  return format({ dateStyle: "short" }, iso);
}

export function formatDateTime(iso: string | null | undefined): string {
  return format({ dateStyle: "short", timeStyle: "medium" }, iso);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
