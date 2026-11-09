import { Link } from "react-router-dom";
import { useEffect } from "react";
import { useFetch } from "../lib/useFetch";
import { notifyOverdueReminders } from "../lib/notifications";
import type { Dashboard, Job, Paged } from "../api/types";
import {
  APPLICATION_STATUS_LABELS,
  JOB_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  formatDate,
  formatDateTime,
  scoreTone,
} from "../lib/format";

export default function Dashboard() {
  const { data, error, loading } = useFetch<Dashboard>("/dashboard");
  const { data: topJobs } = useFetch<Paged<Job>>("/jobs?sort=priority&pageSize=5");

  useEffect(() => {
    if (!data) return;
    // Canal de notificação (Fase 5.2): apenas lembretes vencidos, uma vez por
    // dia. Falhas são logadas dentro do módulo e não interrompem o dashboard.
    notifyOverdueReminders(data.reminders.items.filter((reminder) => reminder.overdue));
  }, [data]);

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
          <span className={`card-number ${data.reminders.overdue > 0 ? "card-number-danger" : ""}`}>
            {data.reminders.overdue}
          </span>
          <span className="card-label">Acompanhamentos vencidos</span>
        </div>
        <div className="card">
          <span className="card-number">{data.jobs.deleted}</span>
          <span className="card-label">Vagas excluídas</span>
        </div>
      </section>

      <section className={`panel ${data.reminders.overdue > 0 ? "panel-overdue" : ""}`}>
        <div className="page-head">
          <h2>Pendências</h2>
          <Link to="/candidaturas">Ver candidaturas</Link>
        </div>
        {data.reminders.items.length === 0 ? (
          <p className="muted">
            Nenhum acompanhamento pendente. Agende um follow-up no detalhe da candidatura.
          </p>
        ) : (
          <ul className="reminder-list">
            {data.reminders.items.map((reminder) => (
              <li key={reminder.id} className={reminder.overdue ? "reminder-overdue" : ""}>
                <span>
                  {reminder.overdue && <span className="badge badge-overdue">vencido</span>}
                  {reminder.overdue && " "}
                  <Link to={`/candidaturas/${reminder.applicationId}`}>{reminder.jobTitle}</Link>
                  {reminder.company && <span className="muted"> — {reminder.company}</span>}
                  {reminder.message && <span className="muted"> · {reminder.message}</span>}
                </span>
                <span className={reminder.overdue ? "reminder-due-overdue" : "muted small"}>
                  {reminder.overdue ? "venceu em " : "vence em "}
                  {formatDate(reminder.dueAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          Os lembretes são apenas locais: o JobPilot não envia nada ao portal nem muda o status da
          candidatura sozinho.
        </p>
      </section>

      <section className="panel">
        <div className="page-head">
          <h2>Melhores oportunidades</h2>
          <Link to="/vagas?sort=priority">Ver todas</Link>
        </div>
        {topJobs && topJobs.items.length > 0 ? (
          <ul className="stat-list">
            {topJobs.items.map((job) => (
              <li key={job.id}>
                <span>
                  <Link to={`/vagas/${job.id}`}>{job.title}</Link>
                  {job.company && <span className="muted"> — {job.company}</span>}
                  {job.status === "prioritized" && <span className="badge">priorizada</span>}
                </span>
                {job.matchScore === null ? (
                  <span className="muted small">sem análise</span>
                ) : (
                  <span className={`score-badge score-${scoreTone(job.matchScore)}`}>
                    {job.matchScore}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Nenhuma vaga cadastrada ainda. <Link to="/vagas">Cadastre ou colete vagas</Link> para
            começar.
          </p>
        )}
        <p className="muted small">
          Prioridade manual (status “Priorizada”) vem primeiro; depois, maior compatibilidade
          analisada pela IA. Vagas sem análise ficam por último.
        </p>
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
