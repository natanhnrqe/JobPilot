import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { parse } from "../middleware/http.js";
import { restoreSchema, settingsSchema } from "../schemas.js";
import { checkDatabase, createBackup, listBackups, restoreBackup } from "../../backup/backup.js";
import { getAllSettings, setSetting } from "../../repositories/settings.js";
import type { ServiceContext } from "../../services/context.js";

function readSettings(ctx: ServiceContext): { displayName: string; timezone: string } {
  const db = ctx.holder.get();
  const raw = getAllSettings(db);
  const map = new Map(raw.map((s) => [s.key, s.value]));
  return {
    displayName:
      typeof map.get("display_name") === "string" ? (map.get("display_name") as string) : "Usuário",
    timezone:
      typeof map.get("timezone") === "string"
        ? (map.get("timezone") as string)
        : "America/Sao_Paulo",
  };
}

export function systemRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/health
  router.get("/health", (_req, res) => {
    let dbOk = false;
    try {
      dbOk = checkDatabase(ctx.holder.get());
    } catch {
      dbOk = false;
    }
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(ctx.config.backendDir, "package.json"), "utf8"),
    ) as { version?: string };
    res.json({
      ok: dbOk,
      db: dbOk ? "ok" : "indisponivel",
      version: packageJson.version ?? "0.0.0",
    });
  });

  // GET /api/v1/settings
  router.get("/settings", (_req, res) => {
    res.json(readSettings(ctx));
  });

  // PUT /api/v1/settings
  router.put("/settings", (req, res) => {
    const input = parse(settingsSchema, req.body ?? {});
    const db = ctx.holder.get();
    db.withTransaction(() => {
      if (input.displayName !== undefined) setSetting(db, "display_name", input.displayName);
      if (input.timezone !== undefined) setSetting(db, "timezone", input.timezone);
    });
    res.json(readSettings(ctx));
  });

  // GET /api/v1/backups
  router.get("/backups", (_req, res) => {
    res.json({ items: listBackups(ctx) });
  });

  // POST /api/v1/backups — cria backup agora
  router.post("/backups", (_req, res) => {
    const backup = createBackup(ctx, "manual");
    res.status(201).json(backup);
  });

  // POST /api/v1/restore — restauração com validação e rollback
  router.post("/restore", (req, res) => {
    const input = parse(restoreSchema, req.body ?? {});
    res.json(restoreBackup(ctx, input));
  });

  return router;
}
