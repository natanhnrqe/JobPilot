import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, qs } from "../api/client";
import type { Job, Paged, WorkMode, ContractType, JobStatus } from "../api/types";
import { useFetch, errorMessage } from "../lib/useFetch";
import {
  CONTRACT_TYPE_LABELS,
  formatDate,
  JOB_STATUS_LABELS,
  WORK_MODE_LABELS,
} from "../lib/format";
import { JobStatusBadge } from "../components/StatusBadge";

const EMPTY_FORM = {
  title: "",
  company: "",
  location: "",
  workMode: "",
  contractType: "",
  salaryText: "",
  sourceUrl: "",
  descriptionText: "",
};

export default function Jobs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const workMode = searchParams.get("workMode") ?? "";
  const contractType = searchParams.get("contractType") ?? "";
  const q = searchParams.get("q") ?? "";
  const includeDeleted = searchParams.get("includeDeleted") === "true";
  const page = Number(searchParams.get("page") ?? "1");

  const path = `/jobs${qs({ status, workMode, contractType, q, includeDeleted: includeDeleted || undefined, page, pageSize: 20 })}`;
  const { data, error, loading, reload } = useFetch<Paged<Job>>(path);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    setSearchParams(next);
  }

  async function createJob(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post<Job>("/jobs", form);
      setForm(EMPTY_FORM);
      setShowForm(false);
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="page-head">
        <h1>Vagas</h1>
        <div className="row-actions">
          <Link className="button-link" to="/vagas/nova">
            + Cadastrar com IA
          </Link>
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Fechar formulário" : "+ Nova vaga"}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="panel job-form" onSubmit={createJob}>
          <h2>Cadastrar vaga manualmente</h2>
          <label>
            Título *
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Desenvolvedor(a) Front-end Júnior"
              required
            />
          </label>
          <div className="form-row">
            <label>
              Empresa
              <input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </label>
            <label>
              Localização
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Ex.: Remoto, São Paulo…"
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Modalidade
              <select
                value={form.workMode}
                onChange={(e) => setForm({ ...form, workMode: e.target.value })}
              >
                <option value="">Não informado</option>
                <option value="remote">Remoto</option>
                <option value="hybrid">Híbrido</option>
                <option value="onsite">Presencial</option>
              </select>
            </label>
            <label>
              Tipo de contrato
              <select
                value={form.contractType}
                onChange={(e) => setForm({ ...form, contractType: e.target.value })}
              >
                <option value="">Não informado</option>
                <option value="internship">Estágio</option>
                <option value="junior">Júnior</option>
                <option value="mid">Pleno</option>
                <option value="senior">Sênior</option>
                <option value="freelance">Freelance</option>
              </select>
            </label>
            <label>
              Salário (texto livre)
              <input
                value={form.salaryText}
                onChange={(e) => setForm({ ...form, salaryText: e.target.value })}
                placeholder="Ex.: R$ 2.500 – R$ 3.000"
              />
            </label>
          </div>
          <label>
            URL original da vaga
            <input
              type="url"
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
              placeholder="https://…"
            />
          </label>
          <label>
            Descrição
            <textarea
              value={form.descriptionText}
              onChange={(e) => setForm({ ...form, descriptionText: e.target.value })}
              rows={5}
              placeholder="Cole aqui a descrição da vaga, requisitos, benefícios…"
            />
          </label>
          {formError && <div className="alert alert-error">{formError}</div>}
          <div className="row-actions">
            <button type="submit" disabled={busy || form.title.trim() === ""}>
              Salvar vaga
            </button>
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="filters panel">
        <label>
          Buscar
          <input
            value={q}
            onChange={(e) => updateFilter("q", e.target.value)}
            placeholder="Título ou empresa…"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => updateFilter("status", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(JOB_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Modalidade
          <select value={workMode} onChange={(e) => updateFilter("workMode", e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(WORK_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contrato
          <select
            value={contractType}
            onChange={(e) => updateFilter("contractType", e.target.value)}
          >
            <option value="">Todos</option>
            {Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => (
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
      {loading && <p className="muted">Carregando…</p>}

      {data && (
        <>
          <p className="muted">
            {data.total} vaga(s) — página {data.page} de {totalPages}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Empresa</th>
                <th>Modalidade</th>
                <th>Contrato</th>
                <th>Descoberta</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((job) => (
                <tr key={job.id} className={job.deletedAt ? "row-deleted" : ""}>
                  <td>
                    <Link to={`/vagas/${job.id}`}>{job.title}</Link>
                    {job.deletedAt && <span className="muted"> (excluída)</span>}
                  </td>
                  <td>{job.company ?? "—"}</td>
                  <td>{WORK_MODE_LABELS[job.workMode as WorkMode]}</td>
                  <td>{CONTRACT_TYPE_LABELS[job.contractType as ContractType]}</td>
                  <td>{formatDate(job.discoveredAt)}</td>
                  <td>
                    <JobStatusBadge status={job.status as JobStatus} />
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nenhuma vaga encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => updateFilter("page", String(page - 1))}>
              ← Anterior
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => updateFilter("page", String(page + 1))}
            >
              Próxima →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
