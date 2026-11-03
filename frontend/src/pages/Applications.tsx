import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, qs } from "../api/client";
import type { Application, ApplicationListItem, ApplicationStatus, Paged } from "../api/types";
import { useFetch, errorMessage } from "../lib/useFetch";
import { APPLICATION_STATUS_LABELS, formatDate, formatDateTime } from "../lib/format";
import { ApplicationStatusBadge } from "../components/StatusBadge";

export default function Applications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const q = searchParams.get("q") ?? "";
  const includeDeleted = searchParams.get("includeDeleted") === "true";
  const page = Number(searchParams.get("page") ?? "1");

  const path = `/applications${qs({ status, q, includeDeleted: includeDeleted || undefined, page, pageSize: 20 })}`;
  const { data, error, loading } = useFetch<Paged<ApplicationListItem>>(path);

  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    setSearchParams(next);
  }

  async function quickStatus(id: number, next: ApplicationStatus) {
    setBusyId(id);
    setActionError(null);
    try {
      await api.patch<Application>(`/applications/${id}`, { status: next });
      window.location.reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1>Candidaturas</h1>

      <div className="filters panel">
        <label>
          Buscar
          <input
            value={q}
            onChange={(e) => updateFilter("q", e.target.value)}
            placeholder="Título da vaga ou empresa…"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => updateFilter("status", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(APPLICATION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => updateFilter("includeDeleted", e.target.checked ? "true" : "")}
          />
          Mostrar excluídas
        </label>
      </div>

      {error && <div className="alert alert-error">{error.message}</div>}
      {actionError && <div className="alert alert-error">{actionError}</div>}
      {loading && <p className="muted">Carregando…</p>}

      {data && (
        <>
          <p className="muted">{data.total} candidatura(s)</p>
          <table className="table">
            <thead>
              <tr>
                <th>Vaga</th>
                <th>Empresa</th>
                <th>Status da candidatura</th>
                <th>Enviada em</th>
                <th>Atualizada</th>
                <th>Ações rápidas</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className={item.deletedAt ? "row-deleted" : ""}>
                  <td>
                    <Link to={`/candidaturas/${item.id}`}>{item.jobTitle}</Link>
                    <div className="muted small">
                      vaga: <Link to={`/vagas/${item.jobId}`}>{item.jobTitle}</Link>
                    </div>
                  </td>
                  <td>{item.company ?? "—"}</td>
                  <td>
                    <ApplicationStatusBadge status={item.status} />
                    {item.deletedAt && <span className="muted"> (excluída)</span>}
                  </td>
                  <td>{formatDate(item.appliedAt)}</td>
                  <td>{formatDateTime(item.updatedAt)}</td>
                  <td>
                    {!item.deletedAt &&
                      (item.status === "preparing" ? (
                        <button
                          onClick={() => quickStatus(item.id, "sent")}
                          disabled={busyId === item.id}
                        >
                          Marcar como enviada
                        </button>
                      ) : (
                        <span className="muted small">ver detalhes</span>
                      ))}
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nenhuma candidatura encontrada. Inicie uma pela página da vaga.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
