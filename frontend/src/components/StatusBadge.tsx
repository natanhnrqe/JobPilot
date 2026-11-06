import type { ApplicationStatus, JobStatus } from "../api/types";
import {
  APPLICATION_STATUS_LABELS,
  EXECUTION_STATUS_LABELS,
  JOB_STATUS_LABELS,
} from "../lib/format";

export function JobStatusBadge({ status }: { status: JobStatus | string }) {
  const label = JOB_STATUS_LABELS[status as JobStatus] ?? status;
  return <span className={`badge badge-job-${status}`}>{label}</span>;
}

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus | string }) {
  const label = APPLICATION_STATUS_LABELS[status as ApplicationStatus] ?? status;
  return <span className={`badge badge-app-${status}`}>{label}</span>;
}

export function ExecutionStatusBadge({ status }: { status: string }) {
  const label = EXECUTION_STATUS_LABELS[status] ?? status;
  return <span className={`badge badge-run-${status}`}>{label}</span>;
}
