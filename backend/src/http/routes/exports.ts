import { Router } from "express";
import { z } from "zod";
import { parse } from "../middleware/http.js";
import {
  EXPORT_ENTITIES,
  EXPORT_FORMATS,
  exportData,
  type ExportEntity,
  type ExportFormat,
} from "../../services/export.js";
import type { ServiceContext } from "../../services/context.js";

const zEntity = z.enum(EXPORT_ENTITIES);
const zFormat = z.enum(EXPORT_FORMATS);

export function exportsRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/exports/:entity?format=csv|json — download do histórico
  router.get("/:entity", (req, res) => {
    const entity = parse(zEntity, req.params.entity) as ExportEntity;
    const format = parse(zFormat, req.query.format ?? "csv") as ExportFormat;
    const result = exportData(ctx, entity, format);

    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(result.body);
  });

  return router;
}
