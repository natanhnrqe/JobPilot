import { useState } from "react";
import type { Note } from "../api/types";
import { api } from "../api/client";
import { errorMessage } from "../lib/useFetch";
import { formatDateTime } from "../lib/format";

interface Props {
  jobId: number;
  notes: Note[];
  onChanged: () => void;
  /** applicationId fixo quando as notas são criadas a partir da candidatura. */
  applicationId?: number;
}

/** Lista de notas com criação, edição e exclusão — tudo persistido na API. */
export function NoteList({ jobId, notes, onChanged, applicationId }: Props) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState("");

  async function add() {
    if (body.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const path =
        applicationId !== undefined
          ? `/applications/${applicationId}/notes`
          : `/jobs/${jobId}/notes`;
      await api.post(path, { body });
      setBody("");
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/notes/${id}`, { body: editingBody });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Excluir esta nota? (exclusão lógica — o banco preserva o registro)"))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/notes/${id}`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notes">
      <div className="note-form">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Nova nota (ex.: contato, feedback, materiais enviados)…"
          rows={2}
        />
        <button onClick={add} disabled={busy || body.trim() === ""}>
          Adicionar nota
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {notes.length === 0 && <p className="muted">Nenhuma nota.</p>}
      <ul className="note-list">
        {notes.map((note) => (
          <li key={note.id}>
            {editingId === note.id ? (
              <div className="note-editing">
                <textarea
                  value={editingBody}
                  onChange={(e) => setEditingBody(e.target.value)}
                  rows={2}
                />
                <div className="row-actions">
                  <button onClick={() => saveEdit(note.id)} disabled={busy}>
                    Salvar
                  </button>
                  <button className="secondary" onClick={() => setEditingId(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="note-item">
                <p>{note.body}</p>
                <div className="note-meta">
                  <span className="muted">{formatDateTime(note.createdAt)}</span>
                  <button
                    className="link"
                    onClick={() => {
                      setEditingId(note.id);
                      setEditingBody(note.body);
                    }}
                  >
                    Editar
                  </button>
                  <button className="link danger" onClick={() => remove(note.id)}>
                    Excluir
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
