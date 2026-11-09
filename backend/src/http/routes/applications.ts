import { Router } from "express";
import { z } from "zod";
import { parse } from "../middleware/http.js";
import {
  listApplicationsQuery,
  updateApplicationSchema,
  createNoteSchema,
  updateNoteSchema,
  createFollowUpSchema,
} from "../schemas.js";
import {
  deleteApplication,
  getApplicationDetail,
  listApplications,
  restoreApplication,
  updateApplication,
} from "../../services/applications.js";
import { completeReminder, createFollowUp } from "../../services/reminders.js";
import { addNote, updateNote, deleteNote } from "../../services/notes.js";
import type { ServiceContext } from "../../services/context.js";

const zId = z.coerce.number().int().positive();

export function applicationsRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/applications — lista com filtros
  router.get("/", (req, res) => {
    const query = parse(listApplicationsQuery, req.query);
    res.json(listApplications(ctx, query));
  });

  // GET /api/v1/applications/:id — detalhe + eventos + notas
  router.get("/:id", (req, res) => {
    const id = parse(zId, req.params.id);
    res.json(getApplicationDetail(ctx, id));
  });

  // PATCH /api/v1/applications/:id — transição de status validada + data de envio
  router.patch("/:id", (req, res) => {
    const id = parse(zId, req.params.id);
    const patch = parse(updateApplicationSchema, req.body ?? {});
    res.json(updateApplication(ctx, id, patch));
  });

  // DELETE /api/v1/applications/:id — exclusão lógica
  router.delete("/:id", (req, res) => {
    const id = parse(zId, req.params.id);
    res.json(deleteApplication(ctx, id));
  });

  // POST /api/v1/applications/:id/restore
  router.post("/:id/restore", (req, res) => {
    const id = parse(zId, req.params.id);
    res.json(restoreApplication(ctx, id));
  });

  // POST /api/v1/applications/:id/follow-up — agenda um acompanhamento local
  router.post("/:id/follow-up", (req, res) => {
    const id = parse(zId, req.params.id);
    const input = parse(createFollowUpSchema, req.body ?? {});
    res.status(201).json(createFollowUp(ctx, id, input));
  });

  // POST /api/v1/applications/:id/reminders/:reminderId/complete
  router.post("/:id/reminders/:reminderId/complete", (req, res) => {
    const id = parse(zId, req.params.id);
    const reminderId = parse(zId, req.params.reminderId);
    res.json(completeReminder(ctx, id, reminderId));
  });

  // POST /api/v1/applications/:id/notes — nota da candidatura
  router.post("/:id/notes", (req, res) => {
    const id = parse(zId, req.params.id);
    const input = parse(createNoteSchema, req.body ?? {});
    const detail = getApplicationDetail(ctx, id);
    res
      .status(201)
      .json(addNote(ctx, { jobId: detail.job.id, applicationId: id, body: input.body }));
  });

  return router;
}

export function notesRouter(ctx: ServiceContext): Router {
  const router = Router();

  // PATCH /api/v1/notes/:id — editar nota
  router.patch("/:id", (req, res) => {
    const id = parse(zId, req.params.id);
    const { body } = parse(updateNoteSchema, req.body ?? {});
    res.json(updateNote(ctx, id, body));
  });

  // DELETE /api/v1/notes/:id — exclusão lógica
  router.delete("/:id", (req, res) => {
    const id = parse(zId, req.params.id);
    res.json(deleteNote(ctx, id));
  });

  return router;
}
