import { AppError } from "../domain/errors.js";
import type { AiConfig } from "../config/index.js";

/**
 * Abstração mínima de provedor de IA (Seção 8 da especificação):
 * uma chamada que deve devolver texto JSON. A camada de serviço valida
 * o resultado com zod — o provedor nunca escreve no banco diretamente.
 *
 * Implementação: API compatível com OpenAI Chat Completions. Funciona com
 * OpenAI, OpenRouter, Groq, DeepSeek e endpoints locais compatíveis
 * (ex.: Ollama/vLLM) apenas trocando AI_BASE_URL/AI_MODEL no .env.
 */

export interface AiCompletion {
  text: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  completeJson(system: string, user: string): Promise<AiCompletion>;
}

export interface AiProviderOptions {
  /** Tentativas totais em falhas transitórias (padrão 3). */
  maxAttempts?: number;
  /** Espera base entre tentativas em ms (padrão 400; cresce exponencialmente). */
  retryDelayMs?: number;
}

/** Status do provedor que valem uma nova tentativa (sobrecarga/cota/erro temporário). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 5000;

export function createAiProvider(config: AiConfig, options: AiProviderOptions = {}): AiProvider {
  return new OpenAiCompatibleProvider(config, options);
}

class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai-compatible";
  readonly model: string;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly config: AiConfig,
    options: AiProviderOptions,
  ) {
    this.model = config.model;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 400);
  }

  async completeJson(system: string, user: string): Promise<AiCompletion> {
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        throw new AppError(
          "AI_UNAVAILABLE",
          503,
          isTimeout
            ? `O provedor de IA não respondeu em ${this.config.timeoutMs} ms.`
            : "Não foi possível conectar ao provedor de IA. Verifique a rede e AI_BASE_URL.",
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");

        // 503 do Gemini é sobrecarga temporária ("model is overloaded"): repetir
        // com espera crescente costuma resolver. O corpo vai em `details.trecho`
        // (não é logado) para o usuário ver o motivo real na UI/API.
        if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxAttempts) {
          await sleep(this.retryDelay(response.headers.get("retry-after"), attempt));
          continue;
        }

        throw this.statusError(response.status, body);
      }

      const payload = (await response.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      } | null;

      const text = payload?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.trim() === "") {
        throw new AppError("AI_ERROR", 502, "Resposta do provedor de IA sem conteúdo utilizável.");
      }

      return {
        text,
        model: this.config.model,
        tokensIn: payload?.usage?.prompt_tokens,
        tokensOut: payload?.usage?.completion_tokens,
      };
    }
  }

  /** Espera entre tentativas: `Retry-After` quando enviado, senão backoff exponencial. */
  private retryDelay(retryAfter: string | null, attempt: number): number {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
    return this.retryDelayMs * 2 ** (attempt - 1);
  }

  private statusError(status: number, body: string): AppError {
    if (status === 401 || status === 403) {
      return new AppError(
        "AI_UNAVAILABLE",
        503,
        "Chave de IA recusada pelo provedor (401/403). Verifique AI_API_KEY.",
      );
    }
    if (status === 429) {
      return new AppError(
        "AI_UNAVAILABLE",
        503,
        "Cota/limite do provedor de IA atingido (429). Tente novamente mais tarde.",
        { trecho: body.slice(0, 200) },
      );
    }
    if (status === 503) {
      return new AppError(
        "AI_UNAVAILABLE",
        503,
        "O provedor de IA está temporariamente sobrecarregado ou indisponível (503). " +
          "Tente novamente em instantes ou use outro AI_MODEL.",
        { trecho: body.slice(0, 200) },
      );
    }
    return new AppError("AI_ERROR", 502, `O provedor de IA respondeu ${status}.`, {
      // Não logar o corpo completo — pode conter detalhes da conta.
      trecho: body.slice(0, 200),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
