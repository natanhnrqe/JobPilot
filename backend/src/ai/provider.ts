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

export function createAiProvider(config: AiConfig): AiProvider {
  return new OpenAiCompatibleProvider(config);
}

class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai-compatible";
  readonly model: string;

  constructor(private readonly config: AiConfig) {
    this.model = config.model;
  }

  async completeJson(system: string, user: string): Promise<AiCompletion> {
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
      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          "AI_UNAVAILABLE",
          503,
          "Chave de IA recusada pelo provedor (401/403). Verifique AI_API_KEY.",
        );
      }
      if (response.status === 429) {
        throw new AppError(
          "AI_UNAVAILABLE",
          503,
          "Cota/limite do provedor de IA atingido (429). Tente novamente mais tarde.",
        );
      }
      throw new AppError("AI_ERROR", 502, `O provedor de IA respondeu ${response.status}.`, {
        // Não logar o corpo completo — pode conter detalhes da conta.
        trecho: body.slice(0, 200),
      });
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
