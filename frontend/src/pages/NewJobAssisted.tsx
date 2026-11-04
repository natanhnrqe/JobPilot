import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ContractType, ExtractionResult, ExtractionStatus, Job } from "../api/types";
import { errorMessage } from "../lib/useFetch";
import { CONTRACT_TYPE_LABELS } from "../lib/format";

/**
 * Cadastro assistido: o usuário informa URL ou cola a descrição, a IA estrutura
 * os campos e o sistema mostra uma PRÉVIA EDITÁVEL. Nada é salvo sem a
 * confirmação humana (a persistência usa o mesmo POST /jobs do cadastro manual).
 */

type Mode = "text" | "url";

interface DraftForm {
  title: string;
  company: string;
  location: string;
  workMode: string;
  contractType: string;
  salaryText: string;
  sourceUrl: string;
  postedAt: string; // YYYY-MM-DD (vazio = não informado)
  descriptionText: string;
}

const EMPTY_DRAFT: DraftForm = {
  title: "",
  company: "",
  location: "",
  workMode: "",
  contractType: "",
  salaryText: "",
  sourceUrl: "",
  postedAt: "",
  descriptionText: "",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

function toDraftForm(draft: ExtractionResult["draft"]): DraftForm {
  return {
    title: draft.title ?? "",
    company: draft.company ?? "",
    location: draft.location ?? "",
    workMode: draft.workMode ?? "",
    contractType: draft.contractType ?? "",
    salaryText: draft.salaryText ?? "",
    sourceUrl: draft.sourceUrl ?? "",
    postedAt: draft.postedAt ? draft.postedAt.slice(0, 10) : "",
    descriptionText: draft.descriptionText ?? "",
  };
}

export default function NewJobAssisted() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ExtractionStatus | null>(null);

  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [sourceUrlHint, setSourceUrlHint] = useState("");
  const [url, setUrl] = useState("");

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);

  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Job | null>(null);

  useEffect(() => {
    api
      .get<ExtractionStatus>("/extractions/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const aiEnabled = status?.enabled === true;

  async function runExtraction(event: React.FormEvent) {
    event.preventDefault();
    setExtracting(true);
    setExtractError(null);
    setSaveError(null);
    setSaved(null);
    try {
      const response =
        mode === "text"
          ? await api.post<ExtractionResult>("/extractions/from-text", {
              text,
              sourceUrl: sourceUrlHint.trim() || undefined,
            })
          : await api.post<ExtractionResult>("/extractions/from-url", { url });
      setResult(response);
      setDraft(toDraftForm(response.draft));
    } catch (err) {
      setExtractError(errorMessage(err));
      setResult(null);
    } finally {
      setExtracting(false);
    }
  }

  async function confirmSave(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) {
      setSaveError("Informe o título antes de salvar.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const job = await api.post<Job>("/jobs", {
        title: draft.title.trim(),
        company: draft.company.trim() || null,
        location: draft.location.trim() || null,
        workMode: draft.workMode || undefined,
        contractType: draft.contractType || undefined,
        salaryText: draft.salaryText.trim() || null,
        sourceUrl: draft.sourceUrl.trim() || null,
        postedAt: draft.postedAt || null,
        descriptionText: draft.descriptionText.trim() || null,
      });
      setSaved(job);
      setResult(null);
      setText("");
      setUrl("");
      setSourceUrlHint("");
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function update(field: keyof DraftForm, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  return (
    <div>
      <div className="page-head">
        <h1>Cadastrar vaga com IA</h1>
        <Link className="button-link" to="/vagas">
          Voltar para vagas
        </Link>
      </div>

      {status !== null && !aiEnabled && (
        <div className="alert alert-warn">
          A extração por IA está desabilitada: nenhuma chave foi configurada. Defina{" "}
          <code>AI_API_KEY</code> no arquivo <code>.env</code> e reinicie o backend (veja{" "}
          <code>docs/INSTALACAO.md</code>). Enquanto isso, o restante do JobPilot funciona
          normalmente e você pode usar o <Link to="/vagas">cadastro manual</Link>.
        </div>
      )}

      <form className="panel" onSubmit={runExtraction}>
        <h2>1. Informe a vaga</h2>
        <div className="row-actions">
          <button
            type="button"
            className={mode === "text" ? "" : "secondary"}
            onClick={() => setMode("text")}
          >
            Colar descrição
          </button>
          <button
            type="button"
            className={mode === "url" ? "" : "secondary"}
            onClick={() => setMode("url")}
          >
            URL da vaga
          </button>
        </div>

        {mode === "text" ? (
          <>
            <label>
              Descrição da vaga
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Cole aqui o texto completo da vaga: cargo, empresa, requisitos, benefícios…"
              />
            </label>
            <label>
              URL da vaga (opcional)
              <input
                type="url"
                value={sourceUrlHint}
                onChange={(e) => setSourceUrlHint(e.target.value)}
                placeholder="https://…"
              />
            </label>
          </>
        ) : (
          <label>
            URL da vaga
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://empresa.com/vagas/123"
            />
          </label>
        )}

        {extractError && <div className="alert alert-error">{extractError}</div>}

        <div className="row-actions">
          <button type="submit" disabled={!aiEnabled || extracting}>
            {extracting ? "Extraindo…" : "Extrair com IA"}
          </button>
          <span className="muted small">
            Nada é salvo automaticamente: você confere a prévia antes de gravar.
          </span>
        </div>
      </form>

      {result && (
        <form className="panel" onSubmit={confirmSave}>
          <h2>2. Confira a prévia e edite o que precisar</h2>

          <p className="muted small">
            Extração {CONFIDENCE_LABELS[result.confidence] ?? result.confidence} • modelo{" "}
            {result.meta.model} • {result.meta.contentLength} caractere(s) analisado(s) • fonte:{" "}
            {result.meta.contentSource === "url" ? "página acessada" : "texto colado"}
          </p>

          {result.extractionNotes.length > 0 && (
            <div className="alert alert-warn">
              <strong>Observações da extração:</strong>
              <ul>
                {result.extractionNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="alert alert-warn">
              <strong>Pontos de atenção:</strong>
              <ul>
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {result.possibleDuplicates.length > 0 && (
            <div className="alert alert-error">
              <strong>Possível duplicata — confira antes de salvar:</strong>
              <ul>
                {result.possibleDuplicates.map((dup) => (
                  <li key={dup.id}>
                    <Link to={`/vagas/${dup.id}`}>
                      {dup.title}
                      {dup.company ? ` — ${dup.company}` : ""}
                    </Link>{" "}
                    <span className="muted">
                      ({dup.status}
                      {dup.reason === "url" ? ", mesma URL" : ", mesma empresa + cargo"})
                    </span>
                  </li>
                ))}
              </ul>
              <span className="muted small">
                Coincidência de empresa e cargo não prova que é a mesma vaga: a decisão é sua.
              </span>
            </div>
          )}

          <label>
            Cargo *
            <input value={draft.title} onChange={(e) => update("title", e.target.value)} required />
          </label>
          <div className="form-row">
            <label>
              Empresa
              <input value={draft.company} onChange={(e) => update("company", e.target.value)} />
            </label>
            <label>
              Localização
              <input
                value={draft.location}
                onChange={(e) => update("location", e.target.value)}
                placeholder="Ex.: São Paulo, SP"
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Modalidade
              <select value={draft.workMode} onChange={(e) => update("workMode", e.target.value)}>
                <option value="">Não identificado</option>
                <option value="remote">Remoto</option>
                <option value="hybrid">Híbrido</option>
                <option value="onsite">Presencial</option>
              </select>
            </label>
            <label>
              Tipo de contrato
              <select
                value={draft.contractType}
                onChange={(e) => update("contractType", e.target.value)}
              >
                <option value="">Não identificado</option>
                {(Object.keys(CONTRACT_TYPE_LABELS) as ContractType[])
                  .filter((key) => key !== "unknown")
                  .map((key) => (
                    <option key={key} value={key}>
                      {CONTRACT_TYPE_LABELS[key]}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Salário (texto livre)
              <input
                value={draft.salaryText}
                onChange={(e) => update("salaryText", e.target.value)}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              URL original
              <input
                type="url"
                value={draft.sourceUrl}
                onChange={(e) => update("sourceUrl", e.target.value)}
                placeholder="https://…"
              />
            </label>
            <label>
              Data de publicação
              <input
                type="date"
                value={draft.postedAt}
                onChange={(e) => update("postedAt", e.target.value)}
              />
              <span className="muted small">Deixe vazio se a fonte não informar a data.</span>
            </label>
          </div>
          <label>
            Descrição
            <textarea
              value={draft.descriptionText}
              onChange={(e) => update("descriptionText", e.target.value)}
              rows={8}
            />
          </label>

          {saveError && <div className="alert alert-error">{saveError}</div>}

          <div className="row-actions">
            <button type="submit" disabled={saving || draft.title.trim() === ""}>
              {saving ? "Salvando…" : "Confirmar e salvar vaga"}
            </button>
            <button type="button" className="secondary" onClick={() => setResult(null)}>
              Descartar prévia
            </button>
          </div>
        </form>
      )}

      {saved && (
        <div className="alert alert-ok">
          Vaga “{saved.title}” salva com sucesso.
          <div className="row-actions">
            <button onClick={() => navigate(`/vagas/${saved.id}`)}>Abrir detalhes da vaga</button>
            <button
              className="secondary"
              onClick={() => {
                setSaved(null);
                setDraft(EMPTY_DRAFT);
              }}
            >
              Cadastrar outra
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
