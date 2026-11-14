/**
 * HTTP de fontes: reutiliza as proteções de `fetch/safeFetch.ts` (SSRF,
 * redirecionamentos revalidados, timeout e limite de tamanho) aceitando
 * JSON como tipo de conteúdo.
 */

import { AppError } from "../domain/errors.js";
import { fetchPublicResource, type SafeFetchOptions } from "../fetch/safeFetch.js";
import { SourceError } from "./types.js";

export interface FetchJsonOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Somente testes (servidor local de teste). */
  allowLoopbackForTests?: boolean;
  /** Cabeçalhos extras (ex.: chave de API). Nunca aparecem em mensagens de erro. */
  headers?: Record<string, string>;
}

const DEFAULT_JSON_TIMEOUT_MS = 30000; // Seção 6.4: timeout por fonte
const DEFAULT_JSON_MAX_BYTES = 5 * 1024 * 1024;

/** Busca uma URL pública e devolve o JSON parseado; erros viram `SourceError`. */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const safeOptions: SafeFetchOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_JSON_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? DEFAULT_JSON_MAX_BYTES,
    allowLoopbackForTests: options.allowLoopbackForTests,
    // Alguns servidores devolvem JSON como text/plain.
    allowedContentTypes: ["application/json", "text/plain"],
    userAgent: "JobPilot/0.1 (local; contato: usuario-local)",
    headers: options.headers,
  };

  let page;
  try {
    page = await fetchPublicResource(url, safeOptions);
  } catch (err) {
    throw toSourceError(err);
  }

  try {
    return JSON.parse(page.content) as T;
  } catch {
    throw new SourceError(
      "parse_error",
      `A fonte devolveu conteúdo que não é JSON válido (${page.finalUrl}).`,
    );
  }
}

function toSourceError(err: unknown): SourceError {
  if (err instanceof AppError) {
    if (err.message.includes("HTTP 429")) return new SourceError("rate_limited", err.message);
    if (err.message.includes("HTTP 401") || err.message.includes("HTTP 403")) {
      return new SourceError("blocked", err.message);
    }
    if (err.status === 400 || err.status === 415 || err.status === 413) {
      return new SourceError("unsupported", err.message);
    }
    return new SourceError("network", err.message);
  }
  return new SourceError("network", err instanceof Error ? err.message : String(err));
}
