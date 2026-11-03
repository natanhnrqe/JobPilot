import type { NextFunction, Request, Response } from "express";
import { z, ZodError, type ZodType, type ZodTypeDef } from "zod";
import { AppError } from "../../domain/errors.js";
import type { Logger } from "../../logging/logger.js";

/** Valida dados com zod; lança AppError 400 com detalhes dos problemas. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", 400, "Dados inválidos.", {
      issues: result.error.issues.map((i) => ({
        campo: i.path.join(".") || "(raiz)",
        problema: i.message,
      })),
    });
  }
  return result.data;
}

/** Envelope de erro padrão da API (Seção 4). */
export function errorEnvelope(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Dados inválidos.",
        details: {
          issues: err.issues.map((i) => ({ campo: i.path.join("."), problema: i.message })),
        },
      },
    });
    return;
  }
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Erro interno inesperado.", details: {} },
  });
}

export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info("requisicao", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duracaoMs: Date.now() - start,
      });
    });
    next();
  };
}

/** Schemas compartilhados de query string. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
