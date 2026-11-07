import { Router } from "express";
import { AppError } from "../../domain/errors.js";
import { parse } from "../middleware/http.js";
import { confirmProfileSchema, cvUploadSchema, updateProfileSchema } from "../schemas.js";
import { getProfile } from "../../repositories/profile.js";
import { confirmProfile, extractProfileFromCv, updateProfile } from "../../services/profile.js";
import type { ServiceContext } from "../../services/context.js";

/**
 * Perfil profissional e importação de currículo (Fase 3, fatia 2).
 *
 * Fluxo de importação: POST /profile/cv devolve uma PRÉVIA sem gravar nada;
 * POST /profile/cv/confirm só persiste depois da revisão humana. O arquivo
 * original do CV não é armazenado — apenas o texto extraído.
 */
export function profileRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/profile
  router.get("/", (_req, res) => {
    res.json(getProfile(ctx.holder.get()));
  });

  // PUT /api/v1/profile — edição manual (não altera o texto do CV já salvo)
  router.put("/", (req, res) => {
    const input = parse(updateProfileSchema, req.body ?? {});
    res.json(updateProfile(ctx, input));
  });

  // POST /api/v1/profile/cv — upload + extração (NÃO persiste)
  router.post("/cv", async (req, res, next) => {
    try {
      const input = parse(cvUploadSchema, req.body ?? {});
      const content = decodeBase64File(input.contentBase64);
      const result = await extractProfileFromCv(ctx, {
        fileName: input.fileName,
        content,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/profile/cv/confirm — confirmação da versão revisada
  router.post("/cv/confirm", (req, res) => {
    const input = parse(confirmProfileSchema, req.body ?? {});
    res.json(confirmProfile(ctx, input));
  });

  return router;
}

/** Aceita base64 puro ou data URL (`data:application/pdf;base64,...`). */
function decodeBase64File(raw: string): Buffer {
  const withoutDataUrl = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  const value = withoutDataUrl.replace(/\s/g, "");
  if (value === "" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      400,
      "Conteúdo do arquivo inválido (base64 malformado).",
    );
  }
  const content = Buffer.from(value, "base64");
  if (content.length === 0) {
    throw new AppError("VALIDATION_ERROR", 400, "O arquivo do currículo está vazio.");
  }
  return content;
}
