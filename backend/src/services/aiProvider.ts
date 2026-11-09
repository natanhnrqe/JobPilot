import { AppError } from "../domain/errors.js";
import type { AiProvider } from "../ai/provider.js";
import type { ServiceContext } from "./context.js";

/**
 * Devolve o provedor de IA configurado ou um erro 503 explicando como
 * habilitá-lo. O restante do JobPilot continua funcionando sem IA.
 */
export function requireAiProvider(ctx: ServiceContext, action: string): AiProvider {
  if (!ctx.ai) {
    throw new AppError(
      "AI_UNAVAILABLE",
      503,
      `${action} por IA indisponível: nenhuma chave configurada. Defina AI_API_KEY no arquivo .env (o restante do JobPilot funciona normalmente).`,
    );
  }
  return ctx.ai;
}
