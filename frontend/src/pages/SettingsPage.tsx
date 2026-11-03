import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { BackupItem, RestoreResult, Settings } from "../api/types";
import { useFetch, errorMessage } from "../lib/useFetch";
import { formatBytes, formatDateTime } from "../lib/format";

export default function SettingsPage() {
  const settings = useFetch<Settings>("/settings");
  const backups = useFetch<{ items: BackupItem[] }>("/backups");

  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezoneValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data) {
      setDisplayName(settings.data.displayName);
      setTimezoneValue(settings.data.timezone);
    }
  }, [settings.data]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      settings.reload();
      backups.reload();
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
