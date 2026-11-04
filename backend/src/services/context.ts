import type { AiProvider } from "../ai/provider.js";
import type { AppConfig } from "../config/index.js";
import type { DbHolder } from "../db/holder.js";

/** Contexto compartilhado pelos serviços (banco, configuração e provedor de IA opcional). */
export interface ServiceContext {
  config: AppConfig;
  holder: DbHolder;
  /** Provedor de IA (null quando AI_API_KEY não está configurada). */
  ai: AiProvider | null;
}
