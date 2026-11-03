import type { AppConfig } from "../config/index.js";
import type { DbHolder } from "../db/holder.js";

/** Contexto compartilhado pelos serviços (banco + configuração). */
export interface ServiceContext {
  config: AppConfig;
  holder: DbHolder;
}
