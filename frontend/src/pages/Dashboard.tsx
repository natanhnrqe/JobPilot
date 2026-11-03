import { Link } from "react-router-dom";
import { useFetch } from "../lib/useFetch";
import type { Dashboard } from "../api/types";
import {
  APPLICATION_STATUS_LABELS,
  JOB_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  formatDateTime,
} from "../lib/format";

export default function Dashboard() {
  const { data, error, loading } = useFetch<Dashboard>("/dashboard");

  if (loading) return <p className="muted">Carregando…</p>;
  if (error) return <div className="alert alert-error">{error.message}</div>;
  if (!data) return null;

  const jobOrder = ["new", "prioritized", "discarded", "closed"] as const;
  const appOrder = ["preparing", "sent", "interview", "offer", "rejected", "withdrawn"] as const;

  return (
    <div>
      <h1>Dashboard</h1>

      <section className="cards">
        <div className="card">
          <span className="card-number">{data.jobs.total}</span>
          <span className="card-label">Vagas cadastradas</span>
        </div>
        <div className="card">
          <span className="card-number">{data.jobs.byStatus["prioritized"] ?? 0}</span>
          <span className="card-label">Priorizadas</span>
        </div>
        <div className="card">
          <span className="card-number">{data.applications.total}</span>
          <span className="card-label">Candidaturas</span>
        </div>
        <div className="card">
          <span className="card-number">{data.jobs.deleted}</span>
          <span className="card-label">Vagas excluídas</span>
        </div>
      </section>

      <section className="grid-2">
        <div className="panel">
          <h2>Vagas por status</h2>
          <ul className="stat-list">
            {jobOrder.map((status) => (
              <li key={status}>
                <Link to={`/vagas?status=${status}`}>{JOB_STATUS_LABELS[status]}</Link>
                <strong>{data.jobs.byStatus[status] ?? 0}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h2>Candidaturas por status</h2>
          <ul className="stat-list">
            {appOrder.map((status) => (
              <li key={status}>
                <Link to={`/candidaturas?status=${status}`}>
                  {APPLICATION_STATUS_LABELS[status]}
                </Link>
                <strong>{data.applications.byStatus[status] ?? 0}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel">
        <h2>Atividade recente</h2>
        {data.activity.length === 0 && (
          <p className="muted">
            Nenhuma atividade ainda. Comece cadastrando uma vaga em <Link to="/vagas">Vagas</Link>.
          </p>
        )}
        <ul className="activity">
          {data.activity.map((item) => (
            <li key={item.id}>
              <span className="activity-type">{EVENT_TYPE_LABELS[item.type] ?? item.type}</span>
              {item.jobId !== null && (
                <>
                  {" — "}
                  <Link to={`/vagas/${item.jobId}`}>{item.jobTitle ?? `Vaga #${item.jobId}`}</Link>
                </>
              )}
              {item.company && <span className="muted"> ({item.company})</span>}
              <span className="muted activity-time">{formatDateTime(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
