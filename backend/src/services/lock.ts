import fs from "node:fs";
import path from "node:path";

/**
 * Lock global de execução (Seção 7.2 da especificação): arquivo
 * `data/.lock` com PID + timestamp. Um lock é **válido** quando o PID ainda
 * está vivo e a idade é menor que 12 h; caso contrário é considerado
 * obsoleto (processo caiu, PC desligado, relógio antigo) e pode ser tomado.
 *
 * Limitação aceita: um PID pode ser reutilizado pelo sistema operacional por
 * outro processo — a janela é pequena e o efeito máximo é uma execução
 * pulada, nunca uma execução concorrente.
 */

/** Idade máxima de um lock válido (12 horas). */
export const LOCK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface LockPayload {
  pid: number;
  /** ISO 8601 de quando o lock foi criado. */
  at: string;
}

export interface LockHandle {
  path: string;
  /** Remove o arquivo somente se ele ainda pertencer a este processo. */
  release(): void;
}

/** Consulta se um PID existe (Windows e Linux: sinal 0 não envia nada). */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = o processo existe, mas não temos permissão para sinalizá-lo.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(lockPath: string): LockPayload | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<LockPayload>;
    if (typeof parsed.pid !== "number" || typeof parsed.at !== "string") return null;
    return { pid: parsed.pid, at: parsed.at };
  } catch {
    // Arquivo inexistente, ilegível ou corrompido: tratado como obsoleto.
    return null;
  }
}

/** Lock válido = PID vivo **e** idade < 12 h (Seção 7.2). */
export function isLockValid(lock: LockPayload, now = Date.now()): boolean {
  const age = now - Date.parse(lock.at);
  return isPidAlive(lock.pid) && Number.isFinite(age) && age < LOCK_MAX_AGE_MS;
}

/**
 * Tenta adquirir o lock. Devolve `null` quando já existe execução válida em
 * andamento — o chamador deve registrar a execução como `skipped`.
 */
export function acquireLock(lockPath: string, now = Date.now()): LockHandle | null {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (fs.existsSync(lockPath)) {
      const existing = readLock(lockPath);
      if (existing && isLockValid(existing, now)) return null;
      // Lock obsoleto: remove e tenta criar de novo.
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Outra instância pode ter removido antes; a criação abaixo decide.
      }
    }

    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }),
        { flag: "wx" },
      );
      return { path: lockPath, release: () => releaseLock(lockPath) };
    } catch (err) {
      // Corrida com outra instância: se o arquivo passou a existir, reavalia.
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  return null;
}

/** Libera o lock (nunca remove o arquivo de outro processo). */
export function releaseLock(lockPath: string): void {
  const current = readLock(lockPath);
  if (!current || current.pid !== process.pid) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Arquivo já removido: nada a fazer.
  }
}
