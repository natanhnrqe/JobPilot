import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { JobDetail, JobStatus, ApplicationStatus } from "../api/types";
import { JOB_TRANSITIONS, APPLICATION_TRANSITIONS } from "../api/types";
import { useFetch, errorMessage } from "../lib/useFetch";
import {
  APPLICATION_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  JOB_STATUS_LABELS,
  WORK_MODE_LABELS,
  formatDate,
} from "../lib/format";
import { ApplicationStatusBadge, JobStatusBadge } from "../components/StatusBadge";
import { EventTimeline } from "../components/EventTimeline";
import { NoteList } from "../components/NoteList";

export default function JobDetail() {
  const { id } = useParams();
  const jobId = Number(id);
  const navigate = useNavigate();
  const { data: job, error, loading, reload } = useFetch<JobDetail>(`/jobs/${jobId}`);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<JobDetail> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <p className="muted">Carregando…</p>;
  if (error) return <div className="alert alert-error">{error.message}</div>;
  if (!job) return null;

  const allowedJobTargets = JOB_TRANSITIONS[job.status];
  const app = job.application;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setForm({ ...job });
    setEditing(true);
  }

  async function saveEdit() {
    if (!form) return;
    await run(() =>
      api.patch(`/jobs/${jobId}`, {
        title: form.title,
        company: form.company ?? "",
        location: form.location ?? "",
        workMode: form.workMode,
        contractType: form.contractType,
        salaryText: form.salaryText ?? "",
        sourceUrl: form.sourceUrl ?? "",
        postedAt: form.postedAt || null,
        descriptionText: form.descriptionText ?? "",
      }),
    );
    setEditing(false);
  }

  async function changeStatus(next: JobStatus) {
    await run(() => api.patch(`/jobs/${jobId}`, { status: next }));
  }

  async function createApplication() {
    await run(() => api.post(`/jobs/${jobId}/application`));
  }

  async function advanceApplication(next: ApplicationStatus) {
    await run(() => api.patch(`/applications/${app!.id}`, { status: next }));
  }

  async function deleteJob() {
    if (
      !window.confirm(
        "Excluir esta vaga? A candidatura (se existir) também será excluída. O histórico é preservado e é possível restaurar.",
      )
    )
      return;
    const done = await run(() => api.delete(`/jobs/${jobId}`));
    if (done !== undefined) navigate("/vagas");
  }

  async function restoreJob() {
    await run(() => api.post(`/jobs/${jobId}/restore`));
  }

  return (
    <div>
      <p>
        <Link to="/vagas">← Voltar para vagas</Link>
      </p>

      <div className="page-head">
        <h1>{job.title}</h1>
        <JobStatusBadge status={job.status} />
      </div>

      {job.deletedAt && (
        <div className="alert alert-warn">
          Esta vaga está excluída desde {formatDate(job.deletedAt)}.{" "}
          <button className="link" onClick={restoreJob} disabled={busy}>
            Restaurar
          </button>
        </div>
      )}

      {actionError && <div className="alert alert-error">{actionError}</div>}

      {editing ? (
        <div className="panel">
          <h2>Editar vaga</h2>
          <label>
            Título
            <input
              value={form?.title ?? ""}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <div className="form-row">
            <label>
              Empresa
              <input
                value={form?.company ?? ""}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </label>
            <label>
              Localização
              <input
                value={form?.location ?? ""}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Modalidade
              <select
                value={form?.workMode ?? "unknown"}
                onChange={(e) =>
                  setForm({ ...form, workMode: e.target.value as JobDetail["workMode"] })
                }
              >
                <option value="unknown">Não informado</option>
                <option value="remote">Remoto</option>
                <option value="hybrid">Híbrido</option>
                <option value="onsite">Presencial</option>
              </select>
            </label>
            <label>
              Tipo de contrato
              <select
                value={form?.contractType ?? "unknown"}
                onChange={(e) =>
                  setForm({ ...form, contractType: e.target.value as JobDetail["contractType"] })
                }
              >
                <option value="unknown">Não informado</option>
                <option value="internship">Estágio</option>
                <option value="junior">Júnior</option>
                <option value="mid">Pleno</option>
                <option value="senior">Sênior</option>
                <option value="freelance">Freelance</option>
              </select>
            </label>
            <label>
              Salário (texto)
              <input
                value={form?.salaryText ?? ""}
                onChange={(e) => setForm({ ...form, salaryText: e.target.value })}
              />
            </label>
          </div>
          <label>
            URL original
            <input
              type="url"
              value={form?.sourceUrl ?? ""}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            />
          </label>
          <label>
            Data de publicação
            <input
              type="date"
              value={form?.postedAt ? form.postedAt.slice(0, 10) : ""}
              onChange={(e) => setForm({ ...form, postedAt: e.target.value || null })}
            />
            <span className="muted small">Deixe vazio se a fonte não informar a data.</span>
          </label>
          <label>
            Descrição
            <textarea
              value={form?.descriptionText ?? ""}
              onChange={(e) => setForm({ ...form, descriptionText: e.target.value })}
              rows={6}
            />
          </label>
          <div className="row-actions">
            <button onClick={saveEdit} disabled={busy}>
              Salvar
            </button>
            <button className="secondary" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="panel">
          <dl className="detail-grid">
            <div>
              <dt>Empresa</dt>
              <dd>{job.company ?? "—"}</dd>
            </div>
            <div>
              <dt>Localização</dt>
              <dd>{job.location ?? "—"}</dd>
            </div>
            <div>
              <dt>Modalidade</dt>
              <dd>{WORK_MODE_LABELS[job.workMode]}</dd>
            </div>
            <div>
              <dt>Tipo de contrato</dt>
              <dd>
                {CONTRACT_TYPE_LABELS[job.contractType]}
                {job.contractTypeSource === "title" && (
                  <span className="muted small"> — classificado pelo título</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Salário</dt>
              <dd>{job.salaryText ?? "—"}</dd>
            </div>
            <div>
              <dt>Data de descoberta</dt>
              <dd>{formatDate(job.discoveredAt)}</dd>
            </div>
            <div>
              <dt>Data de publicação</dt>
              <dd>{job.postedAt ? formatDate(job.postedAt) : "—"}</dd>
            </div>
            <div className="full">
              <dt>URL original</dt>
              <dd>
                {job.sourceUrl ? (
                  <a href={job.sourceUrl} target="_blank" rel="noreferrer noopener">
                    {job.sourceUrl}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          {job.descriptionText && (
            <>
              <h3>Descrição</h3>
              <pre className="description">{job.descriptionText}</pre>
            </>
          )}
          <div className="row-actions">
            <button className="secondary" onClick={startEdit}>
              Editar
            </button>
            {!job.deletedAt && (
              <button className="danger" onClick={deleteJob} disabled={busy}>
                Excluir vaga
              </button>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Status da vaga</h2>
        <div className="status-actions">
          <span className="muted">Mudar para:</span>
          {allowedJobTargets.length === 0 && (
            <span className="muted">sem transições disponíveis</span>
          )}
          {allowedJobTargets.map((target) => (
            <button key={target} onClick={() => changeStatus(target)} disabled={busy}>
              {JOB_STATUS_LABELS[target]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Candidatura</h2>
        {!app && (
          <div>
            <p className="muted">Esta vaga ainda não tem candidatura acompanhada.</p>
            <button onClick={createApplication} disabled={busy || job.deletedAt !== null}>
              Iniciar candidatura
            </button>
          </div>
        )}
        {app && (
          <div>
            <p>
              Status atual: <ApplicationStatusBadge status={app.status} />
              {app.appliedAt && (
                <>
                  {" "}
                  <span className="muted">— enviada em {formatDate(app.appliedAt)}</span>
                </>
              )}
            </p>
            {app.deletedAt && (
              <p className="muted">
                Candidatura excluída (restaure a vaga ou restaure-a pela listagem).
              </p>
            )}
            {!app.deletedAt && (
              <div className="status-actions">
                <Link to={`/candidaturas/${app.id}`} className="button-link">
                  Abrir candidatura
                </Link>
                <span className="muted">Mudar para:</span>
                {APPLICATION_TRANSITIONS[app.status as ApplicationStatus].map((target) => (
                  <button key={target} onClick={() => advanceApplication(target)} disabled={busy}>
                    {APPLICATION_STATUS_LABELS[target]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Notas</h2>
        <NoteList jobId={jobId} notes={job.notes} onChanged={reload} />
      </div>

      <div className="panel">
        <h2>Histórico de eventos</h2>
        <EventTimeline events={job.events} />
      </div>
    </div>
  );
}
