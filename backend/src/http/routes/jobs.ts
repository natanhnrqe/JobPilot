import { Router } from "express";
import { parse } from "../middleware/http.js";
import {
  createNoteSchema,
  listJobsQuery,
  createJobSchema,
  updateJobSchema,
  markApplicationSentSchema,
  applicationDraftRequestSchema,
} from "../schemas.js";
import * as jobsService from "../../services/jobs.js";
import { createApplication, markApplicationSent } from "../../services/applications.js";
import { buildApplicationKit } from "../../services/applicationKit.js";
import { generateApplicationDraft } from "../../services/applicationDraft.js";
import { addNote } from "../../services/notes.js";
import { analyzeJob } from "../../services/analysis.js";
import { getActivity } from "../../services/dashboard.js";
import type { ServiceContext } from "../../services/context.js";

export function jobsRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/jobs — lista com filtros, busca e paginação
  router.get("/", (req, res) => {
    const query = parse(listJobsQuery, req.query);
    res.json(jobsService.listJobs(ctx, query));
  });

  // POST /api/v1/jobs — criação manual
  router.post("/", (req, res) => {
    const input = parse(createJobSchema, req.body ?? {});
    const job = jobsService.createJob(ctx, input);
    res.status(201).json(job);
  });

  // GET /api/v1/jobs/:id — detalhe (com candidatura, notas e eventos)
  router.get("/:id", (req, res) => {
    const id = parse(zId, req.params.id);
    const includeDeleted = req.query.includeDeleted === "true";
    res.json(jobsService.getJobDetail(ctx, id, includeDeleted));
  });

  // PATCH /api/v1/jobs/:id — edição + transição de status validada
  router.patch("/:id", (req, res) => {
    const id = parse(zId, req.params.id);
    const patch = parse(updateJobSchema, req.body ?? {});
    res.json(jobsService.updateJob(ctx, id, patch));
  });

  // DELETE /api/v1/jobs/:id — exclusão lógica (preserva histórico)
  router.delete("/:id", (req, res) => {
    const id = parse(zId, req.params.id);
    res.json(jobsService.deleteJob(ctx, id));
  });

  // POST /api/v1/jobs/:id/restore — restauração
  router.post("/:id/restore", (req, res) => {
    const id = parse(zId, req.params.id);
    res.json(jobsService.restoreJob(ctx, id));
  });

  // POST /api/v1/jobs/:id/analysis — analisa compatibilidade com o perfil (nova versão)
  router.post("/:id/analysis", async (req, res, next) => {
    try {
      const id = parse(zId, req.params.id);
      res.status(201).json(await analyzeJob(ctx, id));
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/jobs/:id/application-kit — dados para a candidatura assistida
  router.get("/:id/application-kit", (req, res) => {
    const id = parse(zId, req.params.id);
    res.json(buildApplicationKit(ctx, id));
  });

  // POST /api/v1/jobs/:id/application-draft — rascunho por IA (não envia nada)
  router.post("/:id/application-draft", async (req, res, next) => {
    try {
      const id = parse(zId, req.params.id);
      const { questions } = parse(applicationDraftRequestSchema, req.body ?? {});
      res.status(201).json(await generateApplicationDraft(ctx, id, questions ?? []));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/jobs/:id/application — cria a candidatura (1:1)
  router.post("/:id/application", (req, res) => {
    const id = parse(zId, req.params.id);
    res.status(201).json(createApplication(ctx, id));
  });

  // POST /api/v1/jobs/:id/application/mark-sent — envio DECLARADO pelo usuário
  router.post("/:id/application/mark-sent", (req, res) => {
    const id = parse(zId, req.params.id);
    const { appliedAt, evidenceUrl } = parse(markApplicationSentSchema, req.body ?? {});
    res.json(markApplicationSent(ctx, id, { appliedAt, evidenceUrl }));
  });

  // POST /api/v1/jobs/:id/notes — nova nota
  router.post("/:id/notes", (req, res) => {
    const id = parse(zId, req.params.id);
    const input = parse(createNoteSchema, req.body ?? {});
    res
      .status(201)
      .json(addNote(ctx, { jobId: id, applicationId: input.applicationId, body: input.body }));
  });

  return router;
}

export function activityRouter(ctx: ServiceContext): Router {
  const router = Router();
  // GET /api/v1/activity?limit=20 — feed de atividade recente
  router.get("/", (req, res) => {
    const raw = Number(req.query.limit ?? 20);
    const limit = Number.isInteger(raw) && raw > 0 && raw <= 100 ? raw : 20;
    res.json(getActivity(ctx, limit));
  });
  return router;
}

import { z } from "zod";
const zId = z.coerce.number().int().positive();
