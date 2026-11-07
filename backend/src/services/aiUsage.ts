import { AppError } from "../domain/errors.js";
import type { AiCompletion, AiProvider } from "../ai/provider.js";
import {
  getTodayAiUsage,
  insertAiUsage,
  type AiUsageKind,
  type AiUsageToday,
} from "../repositories/aiUsage.js";
import { insertExecutionLog } from "../repositories/sources.js";
import type { ServiceContext } from "./context.js";

/**
 * Orçamento diário de IA (Fase 3, tarefa 3.4).
 *
 * Toda chamada ao provedor passa por `completeWithBudget`: ele confere o teto
 * ANTES de enviar o prompt (nada é gasto quando o limite já foi atingido),
 * registra os tokens usados e, ao ultrapassar `AI_DAILY_BUDGET`, recusa novas
 * chamadas até a virada do dia local. Sem teto configurado (0), nada muda.
 */

/** Estimativa conservadora quando o provedor não devolve `usage` (≈4 caracteres/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function getAiUsage(ctx: ServiceContext, now = new Date()): AiUsageToday {
  return getTodayAiUsage(ctx.holder.get(), ctx.config.aiDailyBudget, now);
}

/** Lança 429 AI_BUDGET_EXCEEDED quando o teto do dia já foi atingido. */
export function assertAiBudget(ctx: ServiceContext, now = new Date()): void {
  const budget = ctx.config.aiDailyBudget;
  if (budget <= 0) return;

  const usage = getTodayAiUsage(ctx.holder.get(), budget, now);
  if (!usage.exceeded) return;

  const message =
    `Teto diário de IA atingido: ${usage.totalTokens} de ${budget} tokens usados em ${usage.date}. ` +
    "As chamadas de IA ficam pausadas até a virada do dia; ajuste AI_DAILY_BUDGET no .env para liberar mais.";

  insertExecutionLog(ctx.holder.get(), {
    jobType: "ai",
    level: "warn",
    step: "ai.budget.exceeded",
    message,
    meta: { date: usage.date, usedTokens: usage.totalTokens, budgetTokens: budget },
  });

  throw new AppError("AI_BUDGET_EXCEEDED", 429, message, {
    date: usage.date,
    usedTokens: usage.totalTokens,
    budgetTokens: budget,
  });
}

/**
 * Chama o provedor respeitando o teto diário e registra o consumo.
 *
 * O registro acontece logo após a resposta do provedor (antes da validação do
 * JSON), porque tokens já foram gastos mesmo quando a resposta é inválida.
 */
export async function completeWithBudget(
  ctx: ServiceContext,
  provider: AiProvider,
  kind: AiUsageKind,
  system: string,
  user: string,
  now = new Date(),
): Promise<AiCompletion> {
  assertAiBudget(ctx, now);

  const completion = await provider.completeJson(system, user);
  const estimated = completion.tokensIn === undefined || completion.tokensOut === undefined;

  insertAiUsage(
    ctx.holder.get(),
    {
      kind,
      model: completion.model || provider.model,
      tokensIn: completion.tokensIn ?? estimateTokens(system) + estimateTokens(user),
      tokensOut: completion.tokensOut ?? estimateTokens(completion.text),
      estimated,
    },
    now,
  );

  return completion;
}
