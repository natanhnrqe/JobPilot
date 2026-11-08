import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type {
  AiUsage,
  ApplicationKit,
  ApplicationStatus,
  ChecklistStatus,
  ExtractionStatus,
  JobAnalysis,
  JobDetail,
  JobStatus,
} from "../api/types";
import { JOB_TRANSITIONS, APPLICATION_TRANSITIONS } from "../api/types";
import { useFetch, errorMessage } from "../lib/useFetch";
import {
  ANALYSIS_CONFIDENCE_LABELS,
  APPLICATION_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  GAP_SEVERITY_LABELS,
  JOB_STATUS_LABELS,
  REQUIREMENT_KIND_LABELS,
  REQUIREMENT_MATCH_LABELS,
  WORK_MODE_LABELS,
  formatDate,
  formatDateTime,
  scoreTone,
} from "../lib/format";
import { ApplicationStatusBadge, JobStatusBadge } from "../components/StatusBadge";
import { EventTimeline } from "../components/EventTimeline";
import { NoteList } from "../components/NoteList";

export default function JobDetail() {
  const { id } = useParams();
  const jobId = Number(id);
  const navigate = useNavigate();
  const { data: job, error, loading, reload } = useFetch<JobDetail>(`/jobs/${jobId}`);
  const { data: aiStatus } = useFetch<ExtractionStatus>("/extractions/status");
  const { data: aiUsage, reload: reloadUsage } = useFetch<AiUsage>("/ai/usage");
  const kit = useFetch<ApplicationKit>(`/jobs/${jobId}/application-kit`);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<JobDetail> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <p className="muted">Carregando…</p>;
  if (error) return <div className="alert alert-error">{error.message}</div>;
  if (!job) return null;

  const allowedJobTargets = JOB_TRANSITIONS[job.status];
  const app = job.application;
  const kitData = kit.data;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
      reloadUsage();
      kit.reload();
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

  async function analyzeCompatibility() {
    await run(() => api.post(`/jobs/${jobId}/analysis`));
  }

  async function createApplication() {
    await run(() => api.post(`/jobs/${jobId}/application`));
  }

  async function advanceApplication(next: ApplicationStatus) {
    await run(() => api.patch(`/applications/${app!.id}`, { status: next }));
  }

  async function markSent() {
    if (
      !window.confirm(
        "Confirmar que você já enviou esta candidatura pelo portal? O JobPilot não envia nada sozinho — esta ação apenas registra o envio declarado.",
      )
    )
      return;
    await run(() => api.post(`/jobs/${jobId}/application/mark-sent`));
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
        <div className="page-head">
          <h2>Compatibilidade com o perfil</h2>
          <div className="row-actions">
            {aiStatus?.enabled === false && (
              <span className="muted small">IA não configurada (AI_API_KEY)</span>
            )}
            <button
              onClick={analyzeCompatibility}
              disabled={
                busy ||
                aiStatus?.enabled === false ||
                job.deletedAt !== null ||
                aiUsage?.exceeded === true
              }
            >
              {job.analyses.length > 0 ? "Analisar novamente" : "Analisar com IA"}
            </button>
          </div>
        </div>

        {aiUsage?.exceeded && (
          <div className="alert alert-warn">
            Teto diário de IA atingido ({aiUsage.totalTokens.toLocaleString("pt-BR")} de{" "}
            {aiUsage.budgetTokens.toLocaleString("pt-BR")} tokens em {aiUsage.date}). As chamadas de
            IA ficam pausadas até a virada do dia; ajuste <code>AI_DAILY_BUDGET</code> no{" "}
            <code>.env</code> para liberar mais.
          </div>
        )}

        {job.analyses.length === 0 ? (
          <p className="muted">
            Nenhuma análise ainda. A análise compara esta vaga com o perfil salvo em{" "}
            <Link to="/perfil">Perfil</Link> e sugere um score explicável — ela não altera o status
            da vaga.
          </p>
        ) : (
          <>
            <AnalysisDetails analysis={job.analyses[0]!} />
            {job.analyses.length > 1 && (
              <details className="analysis-history">
                <summary>Análises anteriores ({job.analyses.length - 1})</summary>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Versão</th>
                      <th>Score</th>
                      <th>Sugestão</th>
                      <th>Confiança</th>
                      <th>Modelo</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.analyses.slice(1).map((analysis) => (
                      <tr key={analysis.id}>
                        <td>v{analysis.version}</td>
                        <td>
                          <span className={`score-badge score-${scoreTone(analysis.score)}`}>
                            {analysis.score}
                          </span>
                        </td>
                        <td>{analysis.recommendApply ? "Aplicar" : "Cautela"}</td>
                        <td>{ANALYSIS_CONFIDENCE_LABELS[analysis.confidence]}</td>
                        <td>{analysis.model}</td>
                        <td>{formatDateTime(analysis.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </>
        )}
      </div>

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
        <div className="page-head">
          <h2>Candidatura assistida</h2>
          <button className="secondary" onClick={() => kit.reload()} disabled={kit.loading}>
            Atualizar
          </button>
        </div>
        <p className="muted small">
          O JobPilot prepara os dados, mas <strong>não envia nada</strong>. Abra a vaga, cole o que
          precisar e clique em enviar você mesmo.
        </p>
        {kit.error && <div className="alert alert-error">{kit.error.message}</div>}
        {kitData && (
          <>
            <p>
              <span className="badge">{kitData.portal.label}</span>{" "}
              {kitData.portal.manualOnly && <span className="badge">envio manual</span>}{" "}
              <span className="muted small">{kitData.portal.note}</span>
            </p>

            <div className="row-actions">
              {kitData.job.sourceUrl ? (
                <a
                  className="button-link"
                  href={kitData.job.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Abrir vaga no portal
                </a>
              ) : (
                <span className="muted small">
                  Cadastre o link da vaga para abrir o formulário.
                </span>
              )}
              <button onClick={markSent} disabled={busy || job.deletedAt !== null}>
                Confirmo que enviei
              </button>
            </div>

            <h3>Checklist</h3>
            <ul className="kit-checklist">
              {kitData.checklist.map((item) => (
                <li key={item.id}>
                  <span className={`badge kit-${item.status}`}>
                    {CHECKLIST_STATUS_LABELS[item.status]}
                  </span>{" "}
                  <strong>{item.label}</strong> <span className="muted small">— {item.hint}</span>
                </li>
              ))}
            </ul>

            <h3>Dados do perfil para colar</h3>
            <div className="kit-fields">
              {(
                [
                  ["Nome", kitData.profile.personal.fullName],
                  ["E-mail", kitData.profile.personal.email],
                  ["Telefone", kitData.profile.personal.phone],
                  ["Localização", kitData.profile.personal.location],
                  ["LinkedIn", kitData.profile.personal.linkedinUrl],
                  ["GitHub", kitData.profile.personal.githubUrl],
                  ["Portfólio", kitData.profile.personal.portfolioUrl],
                  ["Resumo", kitData.profile.summary],
                  ["Habilidades", kitData.profile.skills.join(", ") || null],
                  ["Idiomas", kitData.profile.languages.join(", ") || null],
                ] as Array<[string, string | null]>
              ).map(([label, value]) =>
                value ? <CopyField key={label} label={label} value={value} /> : null,
              )}
            </div>
            {!kitData.profile.hasProfile && (
              <p className="muted small">
                Nenhum perfil salvo ainda. <Link to="/perfil">Preencha o perfil</Link> para ver os
                dados aqui.
              </p>
            )}

            {kitData.answers.length > 0 && (
              <>
                <h3>Respostas salvas</h3>
                <div className="kit-fields">
                  {kitData.answers.map((answer) => (
                    <CopyField key={answer.key} label={answer.key} value={answer.value} />
                  ))}
                </div>
              </>
            )}

            {kitData.fit && (
              <>
                <h3>Última análise</h3>
                <p>
                  <span className={`score-badge score-${scoreTone(kitData.fit.score)}`}>
                    {kitData.fit.score}
                  </span>{" "}
                  <strong>
                    {kitData.fit.recommendApply
                      ? "Sugestão: vale aplicar"
                      : "Sugestão: avaliar com cautela"}
                  </strong>{" "}
                  <span className="muted small">
                    · confiança {ANALYSIS_CONFIDENCE_LABELS[kitData.fit.confidence]} · versão{" "}
                    {kitData.fit.version} · {formatDateTime(kitData.fit.createdAt)}
                  </span>
                </p>
                {kitData.fit.summary && <p>{kitData.fit.summary}</p>}
                {kitData.fit.missingRequired.length > 0 && (
                  <div className="alert alert-warn">
                    Requisitos obrigatórios não atendidos pelo perfil:{" "}
                    {kitData.fit.missingRequired.join("; ")}.
                  </div>
                )}
                {kitData.fit.gaps.length > 0 && (
                  <ul className="analysis-list">
                    {kitData.fit.gaps.map((gap, index) => (
                      <li key={`${index}-${gap.text}`}>
                        <span className={`badge gap-${gap.severity}`}>
                          {GAP_SEVERITY_LABELS[gap.severity]}
                        </span>{" "}
                        {gap.text}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
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

const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, string> = {
  ok: "OK",
  warn: "Atenção",
  missing: "Falta",
};

/** Campo somente leitura com botão de copiar (para colar no formulário do portal). */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="kit-field">
      <span className="muted small">{label}</span>
      <code>{value}</code>
      <button className="link" onClick={copy}>
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

function AnalysisDetails({ analysis }: { analysis: JobAnalysis }) {
  return (
    <div>
      <div className="analysis-head">
        <div className={`score-big score-${scoreTone(analysis.score)}`}>
          {analysis.score}
          <span>/100</span>
        </div>
        <div className="analysis-overview">
          <p>
            <strong>
              {analysis.recommendApply ? "Sugestão: vale aplicar" : "Sugestão: avaliar com cautela"}
            </strong>{" "}
            <span className="badge">sugestão da IA</span>
          </p>
          <p className="muted small">
            Confiança {ANALYSIS_CONFIDENCE_LABELS[analysis.confidence]} · versão {analysis.version}{" "}
            · {analysis.model} · {formatDateTime(analysis.createdAt)}
            {analysis.tokensIn !== null && analysis.tokensOut !== null && (
              <> · {analysis.tokensIn + analysis.tokensOut} tokens</>
            )}
          </p>
          {analysis.summary && <p>{analysis.summary}</p>}
        </div>
      </div>

      {analysis.rationale.length > 0 && (
        <>
          <h3>Por que este score</h3>
          <ul className="analysis-list">
            {analysis.rationale.map((item, index) => (
              <li key={`${index}-${item.point}`}>
                <span className={`badge badge-${item.evidence}`}>
                  {item.evidence === "cv" ? "Perfil" : "Vaga"}
                </span>{" "}
                {item.point}
                {item.quote && <q className="analysis-quote">{item.quote}</q>}
              </li>
            ))}
          </ul>
        </>
      )}

      {analysis.requirements.length > 0 && (
        <>
          <h3>Requisitos</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Requisito</th>
                <th>Tipo</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {analysis.requirements.map((item, index) => (
                <tr key={`${index}-${item.text}`}>
                  <td>{item.text}</td>
                  <td>{REQUIREMENT_KIND_LABELS[item.kind]}</td>
                  <td>
                    <span className={`badge match-${item.match}`}>
                      {REQUIREMENT_MATCH_LABELS[item.match]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {analysis.gaps.length > 0 && (
        <>
          <h3>Lacunas</h3>
          <ul className="analysis-list">
            {analysis.gaps.map((item, index) => (
              <li key={`${index}-${item.text}`}>
                <span className={`badge gap-${item.severity}`}>
                  {GAP_SEVERITY_LABELS[item.severity]}
                </span>{" "}
                {item.text}
              </li>
            ))}
          </ul>
        </>
      )}

      {analysis.unknowns.length > 0 && (
        <>
          <h3>Informações desconhecidas</h3>
          <ul className="analysis-list">
            {analysis.unknowns.map((item, index) => (
              <li key={`${index}-${item}`} className="muted">
                {item}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="muted small">
        A pontuação é explicável e não é garantia de contratação. A IA não altera o status da vaga
        nem descarta oportunidades automaticamente.
      </p>
    </div>
  );
}
