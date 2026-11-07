export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "AI_UNAVAILABLE"
  | "AI_ERROR"
  | "AI_INVALID_RESPONSE"
  | "AI_BUDGET_EXCEEDED"
  | "FETCH_ERROR"
  | "CV_ERROR"
  | "BACKUP_ERROR"
  | "RESTORE_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("VALIDATION_ERROR", 400, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super("NOT_FOUND", 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("CONFLICT", 409, message, details);
  }
}

/** Transição de status não permitida pela máquina de estados (Seção 5 da especificação). */
export class InvalidTransitionError extends AppError {
  constructor(
    entity: "vaga" | "candidatura",
    from: string,
    to: string,
    allowed: readonly string[],
  ) {
    super(
      "INVALID_TRANSITION",
      409,
      `Transição de status inválida para ${entity}: de "${from}" para "${to}".`,
      { entity, from, to, allowedTransitions: allowed },
    );
  }
}
