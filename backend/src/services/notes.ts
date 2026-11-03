import { NotFoundError, ValidationError } from "../domain/errors.js";
import { getJobRow } from "../repositories/jobs.js";
import { getApplicationRow } from "../repositories/applications.js";
import { getNoteRow, insertNote, softDeleteNote, updateNoteRow } from "../repositories/notes.js";
import { recordEvent } from "../repositories/events.js";
import type { ServiceContext } from "./context.js";
import { toNoteDto, type NoteDto } from "./jobs.js";

export interface AddNoteInput {
  jobId: number;
  applicationId?: number | null;
  body: string;
}

/**
 * Cria uma nota vinculada à vaga (e opcionalmente à candidatura dessa vaga).
 * Gera evento `note.added` na mesma transação (Seção 5.4).
 */
export function addNote(ctx: ServiceContext, input: AddNoteInput): NoteDto {
  const db = ctx.holder.get();
  return db.withTransaction(() => {
    const job = getJobRow(db, input.jobId);
    if (!job) throw new NotFoundError(`Vaga ${input.jobId} não encontrada.`);

    if (input.applicationId !== undefined && input.applicationId !== null) {
      const app = getApplicationRow(db, input.applicationId, true);
      if (!app) throw new NotFoundError(`Candidatura ${input.applicationId} não encontrada.`);
      if (app.job_id !== input.jobId) {
        throw new ValidationError("A candidatura informada não pertence a esta vaga.");
      }
    }

    const id = insertNote(db, {
      jobId: input.jobId,
      applicationId: input.applicationId ?? null,
      body: input.body,
    });
    recordEvent(db, {
      jobId: input.jobId,
      applicationId: input.applicationId ?? null,
      type: "note.added",
    });
    return toNoteDto(getNoteRow(db, id)!);
  });
}

export function updateNote(ctx: ServiceContext, id: number, body: string): NoteDto {
  const db = ctx.holder.get();
  const row = getNoteRow(db, id);
  if (!row) throw new NotFoundError(`Nota ${id} não encontrada.`);
  updateNoteRow(db, id, body);
  // Edição de nota não gera evento (ver Seção 5.4).
  return toNoteDto(getNoteRow(db, id)!);
}

export function deleteNote(ctx: ServiceContext, id: number): { deleted: true } {
  const db = ctx.holder.get();
  const row = getNoteRow(db, id);
  if (!row) throw new NotFoundError(`Nota ${id} não encontrada.`);
  softDeleteNote(db, id);
  return { deleted: true as const };
}
