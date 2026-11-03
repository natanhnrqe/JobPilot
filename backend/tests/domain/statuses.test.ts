import { describe, expect, it } from "vitest";
import {
  allowedApplicationTransitions,
  allowedJobTransitions,
  canTransitionApplication,
  canTransitionJob,
} from "../../src/domain/statuses.js";
import { InvalidTransitionError } from "../../src/domain/errors.js";

describe("máquina de estados da vaga (Seção 5.1)", () => {
  it("permite as transições definidas", () => {
    expect(canTransitionJob("new", "prioritized")).toBe(true);
    expect(canTransitionJob("new", "discarded")).toBe(true);
    expect(canTransitionJob("new", "closed")).toBe(true);
    expect(canTransitionJob("prioritized", "new")).toBe(true);
    expect(canTransitionJob("prioritized", "discarded")).toBe(true);
    expect(canTransitionJob("prioritized", "closed")).toBe(true);
    expect(canTransitionJob("discarded", "new")).toBe(true);
    expect(canTransitionJob("discarded", "closed")).toBe(true);
    expect(canTransitionJob("closed", "new")).toBe(true);
  });

  it("rejeita transições não definidas", () => {
    expect(canTransitionJob("new", "analyzing")).toBe(false); // estado futuro (Fase 3)
    expect(canTransitionJob("discarded", "prioritized")).toBe(false);
    expect(canTransitionJob("closed", "prioritized")).toBe(false);
  });

  it("permanecer no mesmo status é sempre permitido (idempotente)", () => {
    for (const status of ["new", "prioritized", "discarded", "closed"] as const) {
      expect(canTransitionJob(status, status)).toBe(true);
    }
  });

  it("lista as transições permitidas para respostas 409", () => {
    expect(allowedJobTransitions("new")).toEqual(["prioritized", "discarded", "closed"]);
    expect(allowedJobTransitions("closed")).toEqual(["new"]);
  });
});

describe("máquina de estados da candidatura (Seção 5.2)", () => {
  it("permite o ciclo preparando → enviada → entrevista/oferta/rejeitada", () => {
    expect(canTransitionApplication("preparing", "sent")).toBe(true);
    expect(canTransitionApplication("preparing", "withdrawn")).toBe(true);
    expect(canTransitionApplication("sent", "interview")).toBe(true);
    expect(canTransitionApplication("sent", "offer")).toBe(true);
    expect(canTransitionApplication("sent", "rejected")).toBe(true);
    expect(canTransitionApplication("interview", "offer")).toBe(true);
    expect(canTransitionApplication("interview", "rejected")).toBe(true);
    expect(canTransitionApplication("offer", "withdrawn")).toBe(true);
    expect(canTransitionApplication("withdrawn", "preparing")).toBe(true);
  });

  it("não possui estados da automação (Fase 4)", () => {
    // Estados futuros não existem na máquina do Marco 1.
    const table = JSON.stringify(allowedApplicationTransitions("preparing"));
    expect(table).not.toContain("sending");
    expect(table).not.toContain("approved");
    expect(table).not.toContain("needs_human");
  });

  it("rejected é terminal e sent não volta para preparing", () => {
    expect(canTransitionApplication("rejected", "preparing")).toBe(false);
    expect(canTransitionApplication("sent", "preparing")).toBe(false);
    expect(canTransitionApplication("offer", "sent")).toBe(false);
    expect(canTransitionApplication("rejected", "withdrawn")).toBe(false);
  });

  it("permanecer no mesmo status é sempre permitido", () => {
    for (const status of [
      "preparing",
      "sent",
      "interview",
      "offer",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(canTransitionApplication(status, status)).toBe(true);
    }
  });

  it("InvalidTransitionError carrega as transições permitidas", () => {
    const err = new InvalidTransitionError("vaga", "closed", "prioritized", ["new"]);
    expect(err.status).toBe(409);
    expect(err.code).toBe("INVALID_TRANSITION");
    expect(err.details.allowedTransitions).toEqual(["new"]);
  });
});
