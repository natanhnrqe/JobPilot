import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestServer, type AppServer } from "../helpers.js";
import { getTodayAiUsage, insertAiUsage } from "../../src/repositories/aiUsage.js";
import { estimateTokens } from "../../src/services/aiUsage.js";

let server: AppServer;
let cleanup: () => void;

beforeEach(() => {
  const created = makeTestServer();
  server = created.server;
  cleanup = created.cleanup;
});

afterEach(() => cleanup());

describe("estimateTokens", () => {
  it("estima ≈4 caracteres por token, com mínimo 1", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("getTodayAiUsage", () => {
  it("soma apenas o dia local, agrupa por tipo e calcula o restante", () => {
    const db = server.ctx.holder.get();
    const today = new Date(2026, 10, 6, 12, 0, 0);
    const yesterday = new Date(2026, 10, 5, 23, 0, 0);

    insertAiUsage(
      db,
      { kind: "analysis", model: "m", tokensIn: 10, tokensOut: 5, estimated: false },
      today,
    );
    insertAiUsage(
      db,
      { kind: "analysis", model: "m", tokensIn: 20, tokensOut: 10, estimated: false },
      today,
    );
    insertAiUsage(
      db,
      { kind: "cv", model: "m", tokensIn: 7, tokensOut: 3, estimated: true },
      today,
    );
    insertAiUsage(
      db,
      { kind: "extraction", model: "m", tokensIn: 100, tokensOut: 50, estimated: false },
      yesterday,
    );

    const usage = getTodayAiUsage(db, 100, today);

    expect(usage.date).toBe("2026-11-06");
    expect(usage.calls).toBe(3);
    expect(usage.tokensIn).toBe(37);
    expect(usage.tokensOut).toBe(18);
    expect(usage.totalTokens).toBe(55);
    expect(usage.estimatedCalls).toBe(1);
    expect(usage.byKind.analysis).toMatchObject({ calls: 2, totalTokens: 45 });
    expect(usage.byKind.cv).toMatchObject({ calls: 1, totalTokens: 10 });
    expect(usage.byKind.extraction).toMatchObject({ calls: 0, totalTokens: 0 });
    expect(usage.exceeded).toBe(false);
    expect(usage.remainingTokens).toBe(45);
  });

  it("considera o teto atingido quando o total chega ou passa do limite", () => {
    const db = server.ctx.holder.get();
    const now = new Date(2026, 11, 1, 9, 0, 0);
    insertAiUsage(
      db,
      { kind: "analysis", model: "m", tokensIn: 30, tokensOut: 25, estimated: false },
      now,
    );

    const atLimit = getTodayAiUsage(db, 55, now);
    expect(atLimit.exceeded).toBe(true);
    expect(atLimit.remainingTokens).toBe(0);

    const belowLimit = getTodayAiUsage(db, 56, now);
    expect(belowLimit.exceeded).toBe(false);
    expect(belowLimit.remainingTokens).toBe(1);

    const noLimit = getTodayAiUsage(db, 0, now);
    expect(noLimit.exceeded).toBe(false);
    expect(noLimit.remainingTokens).toBeNull();
  });
});
