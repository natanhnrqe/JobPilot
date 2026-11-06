import { useState } from "react";
import type { ExecutionDetail, ExecutionsResponse, SourceInfo } from "../api/types";
import { useFetch } from "../lib/useFetch";
import {
  EXECUTION_TRIGGER_LABELS,
  LOG_LEVEL_LABELS,
  SOURCE_SUPPORT_LABELS,
  formatDateTime,
} from "../lib/format";
import { ExecutionStatusBadge } from "../components/StatusBadge";

/**
 * Execuções de coleta (Fase 2, 2.6): histórico de `search_runs`, passo a passo
 * de `execution_logs`, fontes registradas e o resumo de `data/last-run.json`.
 * Somente leitura — a coleta é disparada pelo CLI/agendador.
 */

export default function Executions() {
  const { data, error, loading, reload } = useFetch<ExecutionsResponse>("/runs?limit=50");
  const sources = useFetch<{ items: SourceInfo[] }>("/sources");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useFetch<ExecutionDetail>(selectedId === null ? null : `/runs/${selectedId}`);

  function refresh() {
    reload();
    sources.reload();
    if (selectedId !== null) detail.reload();
  }

  function toggle(id: number) {
    setSelectedId((current) => (current === id ? null : id));
  }

  return (
    <div>
      <div className="page-head">
        <h1>Execuções</h1>
        <div className="row-actions">
          <button className="secondary" onClick={refresh} disabled={loading}>
            Atualizar
          </button>
        </div>
      </div>

      <p className="muted">
        Histórico das coletas (manual via <code>npm run collect</code> ou agendada). Cada execução
        registra contadores, resumo e o passo a passo por fonte.
      </p>

      <section className="panel">
        <h2>Resumo da última coleta</h2>
        {data?.lastRun ? (
          <>
            <p>
              <ExecutionStatusBadge status={String(data.lastRun.status ?? "unknown")} />{" "}
              <span className="muted">{data.lastRun.summary ?? "Sem resumo."}</span>
            </p>
            <dl className="detail-grid">
              <div>
                <dt>Execução</dt>
                <dd>{data.lastRun.runId !== undefined ? `#${data.lastRun.runId}` : "—"}</dd>
              </div>
              <div>
                <dt>Origem</dt>
                <dd>
                  {EXECUTION_TRIGGER_LABELS[String(data.lastRun.trigger ?? "")] ??
                    data.lastRun.trigger ??
                    "—"}
                </dd>
              </div>
              <div>
                <dt>Início</dt>
                <dd>{formatDateTime(data.lastRun.startedAt)}</dd>
              </div>
              <div>
                <dt>Fim</dt>
                <dd>{formatDateTime(data.lastRun.finishedAt)}</dd>
              </div>
              <div>
                <dt>Lidas</dt>
                <dd>{data.lastRun.discovered ?? "—"}</dd>
              </div>
              <div>
                <dt>Novas</dt>
                <dd>{data.lastRun.created ?? "—"}</dd>
              </div>
              <div>
                <dt>Duplicadas</dt>
                <dd>{data.lastRun.duplicate ?? "—"}</dd>
              </div>
              <div>
                <dt>Erros</dt>
                <dd>{data.lastRun.errors ?? "—"}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="muted">
            Nenhum <code>last-run.json</code> encontrado. Ele é gravado ao final de cada coleta.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Fontes registradas</h2>
        {sources.error && <div className="alert alert-error">{sources.error.message}</div>}
        {sources.loading && !sources.data && <p className="muted">Carregando…</p>}
        {sources.data && (
          <table className="table">
            <thead>
              <tr>
                <th>Fonte</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Verificada em</th>
                <th>Habilitada</th>
              </tr>
            </thead>
            <tbody>
              {sources.data.items.map((source) => (
                <tr key={source.id}>
                  <td>
                    {source.name} <span className="muted">({source.key})</span>
                  </td>
                  <td>{source.kind === "api" ? "API" : source.kind}</td>
                  <td>{SOURCE_SUPPORT_LABELS[source.supportState] ?? source.supportState}</td>
                  <td>{formatDateTime(source.verifiedAt)}</td>
                  <td>{source.enabled ? "Sim" : "Não"}</td>
                </tr>
              ))}
              {sources.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Nenhuma fonte registrada ainda. Rode uma coleta para registrá-las.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {error && <div className="alert alert-error">{error.message}</div>}
      {loading && !data && <p className="muted">Carregando…</p>}

      {data && (
        <section className="panel">
          <h2>Histórico ({data.runs.length})</h2>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Início</th>
                <th>Origem</th>
                <th>Status</th>
                <th>Duração</th>
                <th>Lidas</th>
                <th>Novas</th>
                <th>Duplicadas</th>
                <th>Erros</th>
                <th>Resumo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id} className={selectedId === run.id ? "row-selected" : ""}>
                  <td>{run.id}</td>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td>{EXECUTION_TRIGGER_LABELS[run.trigger] ?? run.trigger}</td>
                  <td>
                    <ExecutionStatusBadge status={run.status} />
                  </td>
                  <td>{formatDuration(run.durationMs)}</td>
                  <td>{run.discoveredCount}</td>
                  <td>{run.newCount}</td>
                  <td>{run.duplicateCount}</td>
                  <td>{run.errorCount}</td>
                  <td className="small">{run.summary ?? "—"}</td>
                  <td>
                    <button className="secondary" onClick={() => toggle(run.id)}>
                      {selectedId === run.id ? "Ocultar logs" : "Ver logs"}
                    </button>
                  </td>
                </tr>
              ))}
              {data.runs.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted">
                    Nenhuma execução registrada. Rode <code>npm run collect</code> ou aguarde a
                    tarefa agendada das 18:00.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {selectedId !== null && (
        <section className="panel">
          <div className="page-head">
            <h2>Logs da execução #{selectedId}</h2>
            <button className="secondary" onClick={() => setSelectedId(null)}>
              Fechar
            </button>
          </div>

          {detail.error && <div className="alert alert-error">{detail.error.message}</div>}
          {detail.loading && !detail.data && <p className="muted">Carregando logs…</p>}

          {detail.data && (
            <>
              <p>
                <ExecutionStatusBadge status={detail.data.run.status} />{" "}
                <span className="muted">{detail.data.run.summary ?? "Sem resumo."}</span>
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Horário</th>
                    <th>Nível</th>
                    <th>Passo</th>
                    <th>Mensagem</th>
                    <th>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td>
                        <span className={`badge badge-log-${log.level}`}>
                          {LOG_LEVEL_LABELS[log.level] ?? log.level}
                        </span>
                      </td>
                      <td>{log.step ?? "—"}</td>
                      <td>{log.message}</td>
                      <td className="small">
                        {log.meta ? <code>{JSON.stringify(log.meta)}</code> : "—"}
                      </td>
                    </tr>
                  ))}
                  {detail.data.logs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        Nenhum log registrado para esta execução.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest} s`;
}
