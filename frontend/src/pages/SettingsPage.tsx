import { useEffect, useState } from "react";
import { api } from "../api/client";
import type {
  AiUsage,
  BackupItem,
  RestoreResult,
  SearchContractType,
  SearchPreferences,
  Settings,
} from "../api/types";
import { SEARCH_CONTRACT_TYPES } from "../api/types";
import { useFetch, errorMessage } from "../lib/useFetch";
import {
  AI_USAGE_KIND_LABELS,
  CONTRACT_TYPE_LABELS,
  formatBytes,
  formatDateTime,
} from "../lib/format";

export default function SettingsPage() {
  const settings = useFetch<Settings>("/settings");
  const backups = useFetch<{ items: BackupItem[] }>("/backups");
  const preferences = useFetch<SearchPreferences>("/preferences");
  const aiUsage = useFetch<AiUsage>("/ai/usage");

  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezoneValue] = useState("");
  const [contractTypes, setContractTypes] = useState<SearchContractType[]>([]);
  const [includeUnknownContractType, setIncludeUnknownContractType] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data) {
      setDisplayName(settings.data.displayName);
      setTimezoneValue(settings.data.timezone);
    }
  }, [settings.data]);

  useEffect(() => {
    if (preferences.data) {
      setContractTypes(preferences.data.contractTypes);
      setIncludeUnknownContractType(preferences.data.includeUnknownContractType);
    }
  }, [preferences.data]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      settings.reload();
      backups.reload();
      preferences.reload();
      aiUsage.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function saveSettings() {
    void run(async () => {
      await api.put("/settings", { displayName, timezone });
      return "Configurações salvas.";
    });
  }

  function toggleContractType(type: SearchContractType) {
    setContractTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  function savePreferences() {
    void run(async () => {
      await api.put("/preferences", {
        contractTypes,
        includeUnknownContractType,
      });
      return "Preferências de busca salvas. Elas valem para as próximas coletas.";
    });
  }

  function createBackup() {
    void run(async () => {
      const backup = await api.post<BackupItem>("/backups");
      return `Backup criado: ${backup.fileName} (${formatBytes(backup.sizeBytes)}).`;
    });
  }

  function restore(fileName: string) {
    if (
      !window.confirm(
        `Restaurar o backup "${fileName}"?\n\nO banco atual será substituído. Um backup automático do estado atual será criado antes. Esta ação não pode ser desfeita se você não guardar o backup prévio.`,
      )
    ) {
      return;
    }
    void run(async () => {
      const result = await api.post<RestoreResult>("/restore", { fileName, confirm: true });
      return `Banco restaurado de "${fileName}". Backup prévio automático: ${result.preRestoreBackup}. Vagas: ${result.jobs}, candidaturas: ${result.applications}, notas: ${result.notes}, eventos: ${result.events}.`;
    });
  }

  return (
    <div>
      <h1>Configurações</h1>

      {message && <div className="alert alert-ok">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <section className="panel">
        <h2>Preferências locais</h2>
        <label>
          Nome de exibição
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Como quer ser chamado(a) no dashboard"
          />
        </label>
        <label>
          Fuso horário (IANA)
          <input
            value={timezone}
            onChange={(e) => setTimezoneValue(e.target.value)}
            placeholder="America/Sao_Paulo"
          />
        </label>
        <button onClick={saveSettings} disabled={busy}>
          Salvar configurações
        </button>
        <p className="muted small">
          O fuso horário define como as datas são exibidas na interface. Os dados são sempre
          gravados em UTC.
        </p>
      </section>

      <section className="panel">
        <h2>Preferências de busca</h2>
        <p className="muted small">
          Aplicadas na próxima coleta (manual ou automática das 18:00). Não alteram vagas já
          cadastradas.
        </p>
        {preferences.error && <div className="alert alert-error">{preferences.error.message}</div>}
        <div className="preference-options">
          {SEARCH_CONTRACT_TYPES.map((type) => (
            <label key={type} className="checkbox">
              <input
                type="checkbox"
                checked={contractTypes.includes(type)}
                onChange={() => toggleContractType(type)}
              />
              {CONTRACT_TYPE_LABELS[type]}
            </label>
          ))}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeUnknownContractType}
            onChange={(e) => setIncludeUnknownContractType(e.target.checked)}
          />
          Incluir vagas sem nível informado
        </label>
        <button onClick={savePreferences} disabled={busy}>
          Salvar preferências
        </button>
        <p className="muted small">
          Se nenhum tipo for marcado, a coleta não filtra por tipo de contrato. Quando a fonte não
          informa o nível, o JobPilot tenta classificá-lo pelo título (ex.: “Estágio”, “Júnior”); a
          vaga aparece marcada como “classificada pelo título”.
        </p>
        <p className="muted small">
          O Remote OK não informa nível. Com o filtro estrito (sem “sem nível informado”), nenhuma
          vaga dele entra — a classificação pelo título é o que pode incluí-las.
        </p>
      </section>

      <section className="panel">
        <div className="page-head">
          <h2>Uso de IA hoje</h2>
          <button className="secondary" onClick={() => aiUsage.reload()} disabled={aiUsage.loading}>
            Atualizar
          </button>
        </div>
        {aiUsage.error && <div className="alert alert-error">{aiUsage.error.message}</div>}
        {aiUsage.data && (
          <>
            {aiUsage.data.budgetTokens > 0 ? (
              <>
                <p>
                  <strong>{aiUsage.data.totalTokens.toLocaleString("pt-BR")}</strong> de{" "}
                  <strong>{aiUsage.data.budgetTokens.toLocaleString("pt-BR")}</strong> tokens usados
                  em {aiUsage.data.date}.
                  {aiUsage.data.exceeded
                    ? " O teto diário foi atingido."
                    : ` Restam ${(aiUsage.data.remainingTokens ?? 0).toLocaleString("pt-BR")}.`}
                </p>
                <progress
                  className="usage-bar"
                  value={Math.min(aiUsage.data.totalTokens, aiUsage.data.budgetTokens)}
                  max={aiUsage.data.budgetTokens}
                />
              </>
            ) : (
              <p className="muted">
                Sem teto diário configurado (<code>AI_DAILY_BUDGET=0</code>). O uso continua sendo
                registrado.
              </p>
            )}
            {aiUsage.data.exceeded && (
              <div className="alert alert-warn">
                Teto diário de IA atingido: as chamadas de IA estão pausadas até a virada do dia.
                Ajuste <code>AI_DAILY_BUDGET</code> no <code>.env</code> para liberar mais.
              </div>
            )}
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo de chamada</th>
                  <th>Chamadas</th>
                  <th>Tokens de entrada</th>
                  <th>Tokens de saída</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(
                  Object.keys(AI_USAGE_KIND_LABELS) as Array<keyof typeof AI_USAGE_KIND_LABELS>
                ).map((kind) => {
                  const item = aiUsage.data!.byKind[kind];
                  return (
                    <tr key={kind}>
                      <td>{AI_USAGE_KIND_LABELS[kind]}</td>
                      <td>{item.calls}</td>
                      <td>{item.tokensIn.toLocaleString("pt-BR")}</td>
                      <td>{item.tokensOut.toLocaleString("pt-BR")}</td>
                      <td>{item.totalTokens.toLocaleString("pt-BR")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">
              A contagem soma tokens de entrada e saída de todas as chamadas (extração de vagas,
              currículo, análise e rascunho de candidatura). Quando o provedor não informa o
              consumo, o JobPilot estima ≈4 caracteres por token e marca a chamada como estimada
              {aiUsage.data.estimatedCalls > 0 ? ` (${aiUsage.data.estimatedCalls} neste dia)` : ""}
              . O teto é aplicado antes de cada chamada; ao atingi-lo, nada é enviado ao provedor.
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Exportar histórico</h2>
        <p className="muted small">
          Baixe os dados locais em CSV (abre no Excel/LibreOffice) ou JSON. A exportação inclui
          registros excluídos, com a data em <code>deleted_at</code>, para preservar o histórico.
          Nada é enviado para a internet.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Dados</th>
              <th>CSV</th>
              <th>JSON</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Vagas</td>
              <td>
                <a href="/api/v1/exports/jobs?format=csv" download>
                  Baixar CSV
                </a>
              </td>
              <td>
                <a href="/api/v1/exports/jobs?format=json" download>
                  Baixar JSON
                </a>
              </td>
            </tr>
            <tr>
              <td>Candidaturas</td>
              <td>
                <a href="/api/v1/exports/applications?format=csv" download>
                  Baixar CSV
                </a>
              </td>
              <td>
                <a href="/api/v1/exports/applications?format=json" download>
                  Baixar JSON
                </a>
              </td>
            </tr>
            <tr>
              <td>Eventos</td>
              <td>
                <a href="/api/v1/exports/events?format=csv" download>
                  Baixar CSV
                </a>
              </td>
              <td>
                <a href="/api/v1/exports/events?format=json" download>
                  Baixar JSON
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Backup e restauração</h2>
        <p className="muted small">
          O backup é uma cópia íntegra e validada do banco SQLite (integridade verificada antes de
          ser aceito). A restauração cria automaticamente um backup do estado atual, valida o
          arquivo escolhido e, se algo falhar, recupera o estado anterior sozinha.
        </p>
        <button onClick={createBackup} disabled={busy}>
          Criar backup agora
        </button>

        <h3>Backups disponíveis (últimos 14)</h3>
        {backups.error && <div className="alert alert-error">{backups.error.message}</div>}
        {backups.data && backups.data.items.length === 0 && (
          <p className="muted">Nenhum backup ainda.</p>
        )}
        {backups.data && backups.data.items.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Tipo</th>
                <th>Criado em</th>
                <th>Tamanho</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.data.items.map((backup) => (
                <tr key={backup.fileName}>
                  <td>
                    <code>{backup.fileName}</code>
                    {!backup.existsOnDisk && <span className="muted"> (arquivo ausente)</span>}
                  </td>
                  <td>{backup.kind === "pre_restore" ? "pré-restauração (auto)" : "manual"}</td>
                  <td>{formatDateTime(backup.createdAt)}</td>
                  <td>{formatBytes(backup.sizeBytes)}</td>
                  <td>
                    <button
                      onClick={() => restore(backup.fileName)}
                      disabled={busy || !backup.existsOnDisk}
                    >
                      Restaurar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Os arquivos ficam em <code>data/backups/</code>. Guarde cópias fora da pasta do projeto
          para proteção extra. Chaves de ambiente (<code>.env</code>) nunca são incluídas nos
          backups.
        </p>
      </section>

      <section className="panel">
        <h2>Sobre este Marco 1</h2>
        <ul className="muted">
          <li>Vagas cadastradas manualmente (sem busca automática — chega na Fase 2).</li>
          <li>Sem IA, sem automação de envio e sem currículo (Fases 3 e 4).</li>
          <li>Exclusões são lógicas: o histórico nunca é apagado.</li>
          <li>"Enviada" é sempre uma declaração sua, com data registrada.</li>
        </ul>
      </section>
    </div>
  );
}
