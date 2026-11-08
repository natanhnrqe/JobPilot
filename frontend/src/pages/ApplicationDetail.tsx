import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { ApplicationDetail, ApplicationStatus } from "../api/types";
import { APPLICATION_TRANSITIONS } from "../api/types";
import { useFetch, errorMessage } from "../lib/useFetch";
import { APPLICATION_STATUS_LABELS, formatDate, formatDateTime } from "../lib/format";
import { ApplicationStatusBadge } from "../components/StatusBadge";
import { EventTimeline } from "../components/EventTimeline";
import { NoteList } from "../components/NoteList";

export default function ApplicationDetail() {
  const { id } = useParams();
  const appId = Number(id);
  const {
    data: app,
    error,
    loading,
    reload,
  } = useFetch<ApplicationDetail>(`/applications/${appId}`);

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appliedAtInput, setAppliedAtInput] = useState("");
  const [evidenceInput, setEvidenceInput] = useState("");

  if (loading) return <p className="muted">Carregando…</p>;
  if (error) return <div className="alert alert-error">{error.message}</div>;
  if (!app) return null;

  const allowed = APPLICATION_TRANSITIONS[app.status];

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setAppliedAtInput("");
      setEvidenceInput("");
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function changeStatus(next: ApplicationStatus) {
    if (next === "sent") {
      // Envio é sempre uma declaração do usuário, com data.
      const date = window.prompt(
        "Confirme a data em que a candidatura foi enviada (AAAA-MM-DD). Deixe vazio para usar agora:",
        new Date().toISOString().slice(0, 10),
      );
      if (date === null) return; // cancelado
      void run(() => api.patch(`/applications/${appId}`, { status: "sent", appliedAt: date }));
      return;
    }
    void run(() => api.patch(`/applications/${appId}`, { status: next }));
  }

  function saveAppliedAt() {
    if (appliedAtInput.trim() === "") return;
    void run(() => api.patch(`/applications/${appId}`, { appliedAt: appliedAtInput.trim() }));
  }

  function saveEvidence() {
    const value = evidenceInput.trim();
    void run(() =>
      api.patch(`/applications/${appId}`, { evidenceUrl: value === "" ? null : value }),
    );
  }

  return (
    <div>
      <p>
        <Link to="/candidaturas">← Voltar para candidaturas</Link>
      </p>

      <div className="page-head">
        <h1>{app.job.title}</h1>
        <ApplicationStatusBadge status={app.status} />
      </div>

      {actionError && <div className="alert alert-error">{actionError}</div>}

      <div className="panel">
        <dl className="detail-grid">
          <div>
            <dt>Empresa</dt>
            <dd>{app.job.company ?? "—"}</dd>
          </div>
          <div>
            <dt>Vaga</dt>
            <dd>
              <Link to={`/vagas/${app.job.id}`}>Abrir detalhes da vaga</Link>
            </dd>
          </div>
          <div>
            <dt>Status da vaga</dt>
            <dd>{app.job.status}</dd>
          </div>
          <div>
            <dt>Data de envio</dt>
            <dd>{formatDate(app.appliedAt)}</dd>
          </div>
          <div>
            <dt>Portal</dt>
            <dd>{app.portalKey ?? "—"}</dd>
          </div>
          <div>
            <dt>Evidência</dt>
            <dd>
              {app.evidenceUrl ? (
                <a href={app.evidenceUrl} target="_blank" rel="noreferrer noopener">
                  Abrir link
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Status da candidatura</dt>
            <dd>{APPLICATION_STATUS_LABELS[app.status]}</dd>
          </div>
          <div>
            <dt>Criada em</dt>
            <dd>{formatDateTime(app.createdAt)}</dd>
          </div>
        </dl>

        {app.job.status === "discarded" || app.job.status === "closed" ? (
          <div className="alert alert-warn">
            A vaga está {app.job.status === "discarded" ? "descartada" : "encerrada"}, mas a
            candidatura permanece como está — acompanhe-a manualmente.
          </div>
        ) : null}

        <h3>Transições permitidas</h3>
        {allowed.length === 0 ? (
          <p className="muted">
            Status terminal — nenhuma transição disponível (é possível editar a data de envio
            abaixo, se aplicável).
          </p>
        ) : (
          <div className="status-actions">
            {allowed.map((target) => (
              <button key={target} onClick={() => changeStatus(target)} disabled={busy}>
                {APPLICATION_STATUS_LABELS[target]}
              </button>
            ))}
          </div>
        )}

        {app.status === "sent" && (
          <>
            <div className="form-row">
              <label>
                Corrigir data de envio (AAAA-MM-DD)
                <input
                  type="date"
                  value={appliedAtInput}
                  onChange={(e) => setAppliedAtInput(e.target.value)}
                />
              </label>
              <button onClick={saveAppliedAt} disabled={busy || appliedAtInput === ""}>
                Salvar data
              </button>
            </div>
            <div className="form-row">
              <label>
                Link de evidência (vazio remove)
                <input
                  type="url"
                  placeholder={app.evidenceUrl ?? "https://…"}
                  value={evidenceInput}
                  onChange={(e) => setEvidenceInput(e.target.value)}
                />
              </label>
              <button onClick={saveEvidence} disabled={busy}>
                Salvar evidência
              </button>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Notas da candidatura</h2>
        <NoteList jobId={app.job.id} applicationId={app.id} notes={app.notes} onChanged={reload} />
      </div>

      <div className="panel">
        <h2>Histórico da candidatura</h2>
        <EventTimeline events={app.events} />
      </div>
    </div>
  );
}
