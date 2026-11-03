import type { ApplicationStatus, Event, JobStatus } from "../api/types";
import {
  APPLICATION_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  JOB_STATUS_LABELS,
  formatDateTime,
} from "../lib/format";

/** Linha do tempo do histórico de eventos (imutável, do mais recente ao mais antigo). */
export function EventTimeline({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return <p className="muted">Nenhum evento registrado.</p>;
  }
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.id}>
          <div className="timeline-head">
            <strong>{EVENT_TYPE_LABELS[event.type] ?? event.type}</strong>
            <span className="muted">{formatDateTime(event.createdAt)}</span>
          </div>
          {event.type.includes("status_changed") && (
            <span className="transition">
              {prettyValue(event.type, event.from)} → {prettyValue(event.type, event.to)}
            </span>
          )}
          {event.message && <span className="muted"> — {event.message}</span>}
        </li>
      ))}
    </ol>
  );
}

function prettyValue(eventType: string, value: string | null): string {
  if (!value) return "—";
  if (eventType.startsWith("application.")) {
    return APPLICATION_STATUS_LABELS[value as ApplicationStatus] ?? value;
  }
  return JOB_STATUS_LABELS[value as JobStatus] ?? value;
}
