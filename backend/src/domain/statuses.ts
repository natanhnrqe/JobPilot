/**
 * Máquinas de estado — fonte única de verdade das transições permitidas.
 * Vagas (5.1) e candidaturas (5.2) possuem estados e transições SEPARADOS:
 * mudar o status de um nunca altera o do outro.
 * Toda transição é validada aqui antes de qualquer gravação no banco.
 */

export const JOB_STATUSES = ["new", "prioritized", "discarded", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: "Nova",
  prioritized: "Priorizada",
  discarded: "Descartada",
  closed: "Encerrada",
};

export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  new: ["prioritized", "discarded", "closed"],
  prioritized: ["discarded", "closed", "new"],
  discarded: ["new", "closed"],
  closed: ["new"],
};

export const APPLICATION_STATUSES = [
  "preparing",
  "sent",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  preparing: "Em preparação",
  sent: "Enviada",
  interview: "Entrevista",
  offer: "Oferta",
  rejected: "Rejeitada",
  withdrawn: "Retirada",
};

export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  preparing: ["sent", "withdrawn"],
  sent: ["interview", "offer", "rejected", "withdrawn"],
  interview: ["offer", "rejected", "withdrawn"],
  offer: ["withdrawn"],
  rejected: [],
  withdrawn: ["preparing"],
};

function canTransition(
  table: Record<string, readonly string[]>,
  from: string,
  to: string,
): boolean {
  return (table[from] ?? []).includes(to);
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return from === to || canTransition(JOB_TRANSITIONS, from, to);
}

export function canTransitionApplication(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return from === to || canTransition(APPLICATION_TRANSITIONS, from, to);
}

/** Lista legível de transições permitidas, para respostas 409. */
export function allowedJobTransitions(from: JobStatus): readonly JobStatus[] {
  return JOB_TRANSITIONS[from];
}

export function allowedApplicationTransitions(
  from: ApplicationStatus,
): readonly ApplicationStatus[] {
  return APPLICATION_TRANSITIONS[from];
}
