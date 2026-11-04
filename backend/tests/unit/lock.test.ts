import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, isLockValid, releaseLock } from "../../src/services/lock.js";

/**
 * Testes do lock de arquivo da coleta (Seção 7.2): nada de rede, tudo em
 * diretório temporário.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-lock-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function lockPath(): string {
  return path.join(dir, ".lock");
}

function writeLock(payload: unknown): void {
  fs.writeFileSync(lockPath(), JSON.stringify(payload), "utf8");
}

describe("Lock de arquivo da coleta", () => {
  it("adquire o lock quando não existe arquivo e grava PID + timestamp", () => {
    const lock = acquireLock(lockPath());
    expect(lock).not.toBeNull();

    const payload = JSON.parse(fs.readFileSync(lockPath(), "utf8")) as {
      pid: number;
      at: string;
    };
    expect(payload.pid).toBe(process.pid);
    expect(Number.isNaN(Date.parse(payload.at))).toBe(false);

    lock?.release();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it("recusa quando há lock válido (PID vivo e recente)", () => {
    writeLock({ pid: process.pid, at: new Date().toISOString() });
    expect(acquireLock(lockPath())).toBeNull();
  });

  it("ignora lock com idade acima de 12 h (mesmo com PID vivo)", () => {
    writeLock({ pid: process.pid, at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() });
    const lock = acquireLock(lockPath());
    expect(lock).not.toBeNull();
    lock?.release();
  });

  it("ignora arquivo de lock corrompido (considera obsoleto)", () => {
    fs.writeFileSync(lockPath(), "isto não é json", "utf8");
    const lock = acquireLock(lockPath());
    expect(lock).not.toBeNull();
    lock?.release();
  });

  it("nunca remove o lock de outro processo ao liberar", () => {
    writeLock({ pid: process.pid + 1, at: new Date().toISOString() });
    releaseLock(lockPath());
    expect(fs.existsSync(lockPath())).toBe(true);
  });

  it("isLockValid exige PID vivo e timestamp legível", () => {
    expect(isLockValid({ pid: -1, at: new Date().toISOString() })).toBe(false);
    expect(isLockValid({ pid: process.pid, at: "não é data" })).toBe(false);
    expect(isLockValid({ pid: process.pid, at: new Date().toISOString() })).toBe(true);
  });
});
