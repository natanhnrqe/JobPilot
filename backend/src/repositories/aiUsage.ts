import type { Db } from "../db/connection.js";

/**
 * Uso de IA por chamada (migração 007).
 *
 * O teto diário (`AI_DAILY_BUDGET`) é aplicado sobre a soma de tokens de
 * entrada + saída do dia local. Quando o provedor não informa `usage`, os
 * tokens são estimados (≈4 caracteres/token) e `estimated` fica 1 — o valor
 * estimado é conservador e nunca subestima grosseiramente o consumo.
 */

export const AI_USAGE_KINDS = ["extraction", "cv", "analysis", "draft"] as const;
export type AiUsageKind = (typeof AI_USAGE_KINDS)[number];

export interface AiUsageInsert {
  kind: AiUsageKind;
  model: string;
  tokensIn: number;
  tokensOut: number;
  estimated: boolean;
}

export interface AiUsageTotals {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  estimatedCalls: number;
}

export interface AiUsageToday extends AiUsageTotals {
  /** Dia local no formato YYYY-MM-DD. */
  date: string;
  /** Teto configurado em tokens (0 = sem limite). */
  budgetTokens: number;
  /** Tokens restantes hoje; null quando não há teto. */
  remainingTokens: number | null;
  /** true quando o teto foi atingido (ou ultrapassado). */
  exceeded: boolean;
  byKind: Record<AiUsageKind, AiUsageTotals>;
}

interface UsageRow {
  kind: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  estimated_calls: number;
}

export function insertAiUsage(db: Db, input: AiUsageInsert, now = new Date()): void {
  db.run(
    `INSERT INTO ai_usage (kind, model, tokens_in, tokens_out, estimated, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.kind,
      input.model,
      Math.max(0, Math.round(input.tokensIn)),
      Math.max(0, Math.round(input.tokensOut)),
      input.estimated ? 1 : 0,
      now.toISOString(),
    ],
  );
}

/** Uso do dia local corrente (meia-noite local até a próxima meia-noite). */
export function getTodayAiUsage(db: Db, budgetTokens: number, now = new Date()): AiUsageToday {
  const { start, end, date } = localDayRange(now);
  const rows = db.all<UsageRow>(
    `SELECT kind,
            COUNT(*) AS calls,
            COALESCE(SUM(tokens_in), 0) AS tokens_in,
            COALESCE(SUM(tokens_out), 0) AS tokens_out,
            COALESCE(SUM(estimated), 0) AS estimated_calls
       FROM ai_usage
      WHERE created_at >= ? AND created_at < ?
      GROUP BY kind`,
    [start.toISOString(), end.toISOString()],
  );

  const emptyTotals = (): AiUsageTotals => ({
    calls: 0,
    tokensIn: 0,
    tokensOut: 0,
    totalTokens: 0,
    estimatedCalls: 0,
  });

  const byKind: Record<AiUsageKind, AiUsageTotals> = {
    extraction: emptyTotals(),
    cv: emptyTotals(),
    analysis: emptyTotals(),
    draft: emptyTotals(),
  };
  const total = emptyTotals();

  for (const row of rows) {
    const kind = AI_USAGE_KINDS.find((value) => value === row.kind);
    if (!kind) continue;
    const item: AiUsageTotals = {
      calls: row.calls,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      totalTokens: row.tokens_in + row.tokens_out,
      estimatedCalls: row.estimated_calls,
    };
    byKind[kind] = item;
    total.calls += item.calls;
    total.tokensIn += item.tokensIn;
    total.tokensOut += item.tokensOut;
    total.totalTokens += item.totalTokens;
    total.estimatedCalls += item.estimatedCalls;
  }

  const exceeded = budgetTokens > 0 && total.totalTokens >= budgetTokens;

  return {
    date,
    budgetTokens,
    remainingTokens: budgetTokens > 0 ? Math.max(0, budgetTokens - total.totalTokens) : null,
    exceeded,
    ...total,
    byKind,
  };
}

/** Início/fim do dia no fuso local da máquina (o mesmo da tarefa das 18:00). */
function localDayRange(now: Date): { start: Date; end: Date; date: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    start,
    end,
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
