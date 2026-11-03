import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AppError, NotFoundError, ValidationError } from "../domain/errors.js";
import type { Db } from "../db/connection.js";
import {
  insertBackupRow,
  listBackupRows,
  ensureBackupRow,
  type BackupRow,
} from "../repositories/backups.js";
import type { ServiceContext } from "../services/context.js";

const RETENTION = 14;
const REQUIRED_TABLES = [
  "schema_migrations",
  "settings",
  "jobs",
  "applications",
  "events",
  "notes",
  "backups",
];

export interface BackupDto {
  fileName: string;
  sizeBytes: number;
  kind: string;
  createdAt: string;
  existsOnDisk: boolean;
}

/** Verifica integridade e esquema de um arquivo SQLite (backup ou banco restaurado). */
export function validateDatabaseFile(
  filePath: string,
  logger?: { warn(message: string, meta?: unknown): void },
): { ok: true } | { ok: false; problem: string } {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(filePath);
    const integrity = db.prepare("PRAGMA integrity_check").get() as
      { integrity_check: string } | undefined;
    if (!integrity || integrity.integrity_check !== "ok") {
      const problem = integrity ? integrity.integrity_check : "sem resultado";
      return { ok: false, problem: `integrity_check: ${problem}` };
    }

    const tables = new Set(
      (
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
          )
          .all() as Array<{ name: string }>
      ).map((r) => r.name),
    );
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length > 0) {
      return { ok: false, problem: `tabelas ausentes: ${missing.join(", ")}` };
    }

    const fkIssues = db.prepare("PRAGMA foreign_key_check").all();
    if (fkIssues.length > 0) {
      return { ok: false, problem: `violacoes de chave estrangeira: ${fkIssues.length}` };
    }
    return { ok: true };
  } catch (err) {
    logger?.warn("Falha ao validar arquivo SQLite", { erro: String(err) });
    return { ok: false, problem: String(err) };
  } finally {
    try {
      db?.close();
    } catch {
      // ignora
    }
  }
}

function timestampForFileName(date = new Date()): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `-${pad(date.getMilliseconds(), 3)}`
  );
}

/**
 * Cria um backup consistente via `VACUUM INTO` (nunca copia o arquivo com
 * o WAL aberto — Seção 10.2) e valida o resultado antes de registrá-lo.
 */
export function createBackup(
  ctx: ServiceContext,
  kind: "manual" | "pre_restore" = "manual",
): BackupDto {
  const db = ctx.holder.get();
  fs.mkdirSync(ctx.config.backupsDir, { recursive: true });

  const fileName = `jobpilot-${timestampForFileName()}.sqlite`;
  const filePath = path.join(ctx.config.backupsDir, fileName);
  const escaped = filePath.replace(/'/g, "''");

  try {
    db.exec(`VACUUM INTO '${escaped}'`);
  } catch (err) {
    throw new AppError("BACKUP_ERROR", 500, `Falha ao criar backup: ${String(err)}`);
  }

  const validation = validateDatabaseFile(filePath);
  if (!validation.ok) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignora
    }
    throw new AppError(
      "BACKUP_ERROR",
      500,
      `Backup gerado não passou na validação (${validation.problem}); arquivo descartado.`,
    );
  }

  const sizeBytes = fs.statSync(filePath).size;
  const createdAt = new Date().toISOString();
  db.withTransaction(() => {
    insertBackupRow(db, { fileName, sizeBytes, kind, createdAt });
  });

  // O arquivo de backup é autodescritivo: carrega o próprio registro na
  // tabela `backups` do snapshot, para que a restauração o conheça.
  registerBackupInsideFile(filePath, { fileName, sizeBytes, kind, createdAt });

  pruneBackups(ctx);

  return { fileName, sizeBytes, kind, createdAt, existsOnDisk: true };
}

/** Mantém apenas os `RETENTION` backups mais recentes (arquivo + registro). */
export function pruneBackups(ctx: ServiceContext): void {
  const db = ctx.holder.get();
  const rows = db.all<BackupRow & { id: number }>(
    "SELECT * FROM backups ORDER BY created_at DESC, id DESC",
  );
  const excess = rows.slice(RETENTION);
  for (const row of excess) {
    const filePath = path.join(ctx.config.backupsDir, row.file_name);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignora
    }
    db.run("DELETE FROM backups WHERE id = ?", [row.id]);
  }
}

export function listBackups(ctx: ServiceContext): BackupDto[] {
  const db = ctx.holder.get();
  return listBackupRows(db).map((row) => ({
    fileName: row.file_name,
    sizeBytes: row.size_bytes ?? 0,
    kind: row.kind,
    createdAt: row.created_at,
    existsOnDisk: fs.existsSync(path.join(ctx.config.backupsDir, row.file_name)),
  }));
}

/** Insere o registro do backup dentro do próprio arquivo de snapshot. */
function registerBackupInsideFile(
  filePath: string,
  data: { fileName: string; sizeBytes: number; kind: "manual" | "pre_restore"; createdAt: string },
): void {
  const snapshot = new DatabaseSync(filePath);
  try {
    snapshot
      .prepare(
        "INSERT OR IGNORE INTO backups (file_name, size_bytes, kind, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(data.fileName, data.sizeBytes, data.kind, data.createdAt);
  } finally {
    snapshot.close();
  }
}

function resolveBackupFilePath(ctx: ServiceContext, fileName: string): string {
  const clean = path.basename(fileName);
  if (clean !== fileName || fileName.includes("/") || fileName.includes("\\")) {
    throw new ValidationError("Nome de arquivo de backup inválido.");
  }
  const filePath = path.join(ctx.config.backupsDir, clean);
  if (!fs.existsSync(filePath)) {
    throw new NotFoundError(`Backup "${clean}" não encontrado.`);
  }
  return filePath;
}

export interface RestoreResult {
  restored: true;
  preRestoreBackup: string;
  jobs: number;
  applications: number;
  notes: number;
  events: number;
}

/**
 * Restaura um backup com validação em todas as etapas (Seção 10.2):
 * valida o arquivo candidato, cria backup prévio automático, substitui
 * o banco, revalida e, em falha, restaura automaticamente o pré-backup.
 */
export function restoreBackup(
  ctx: ServiceContext,
  input: { fileName: string; confirm: boolean },
): RestoreResult {
  if (input.confirm !== true) {
    throw new ValidationError('A restauração exige confirmação explícita ({"confirm": true}).');
  }

  const filePath = resolveBackupFilePath(ctx, input.fileName);
  const validation = validateDatabaseFile(filePath);
  if (!validation.ok) {
    throw new AppError(
      "RESTORE_ERROR",
      400,
      `O arquivo de backup não passou na validação (${validation.problem}); restauração cancelada.`,
    );
  }

  // Backup automático do estado atual antes de qualquer mudança.
  const pre = createBackup(ctx, "pre_restore");
  const prePath = path.join(ctx.config.backupsDir, pre.fileName);

  try {
    ctx.holder.swapDatabaseFile(filePath);
  } catch (err) {
    ctx.holder.swapDatabaseFile(prePath);
    throw new AppError("RESTORE_ERROR", 500, `Falha ao substituir o banco: ${String(err)}`);
  }

  // Revalidação do banco restaurado.
  const db = ctx.holder.get();
  const post = validateDatabaseFile(ctx.config.databasePath);
  const counts = post.ok
    ? {
        jobs: (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs")?.n ?? 0) as number,
        applications: (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM applications")?.n ??
          0) as number,
        notes: (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notes")?.n ?? 0) as number,
        events: (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM events")?.n ?? 0) as number,
      }
    : null;

  if (!post.ok || !counts) {
    // Rollback automático: devolve o estado anterior.
    ctx.holder.swapDatabaseFile(prePath);
    throw new AppError(
      "RESTORE_ERROR",
      500,
      `O banco restaurado não passou na revalidação (${post.ok ? "contagens indisponíveis" : post.problem}); estado anterior recuperado automaticamente.`,
    );
  }

  // Reconcilia o registro de backups no banco restaurado: o arquivo
  // restaurado e o backup prévio precisam continuar visíveis na UI.
  db.withTransaction(() => {
    ensureBackupRow(db, {
      fileName: path.basename(filePath),
      sizeBytes: fs.statSync(filePath).size,
      kind: "manual",
      createdAt: new Date().toISOString(),
    });
    ensureBackupRow(db, {
      fileName: pre.fileName,
      sizeBytes: pre.sizeBytes,
      kind: "pre_restore",
      createdAt: pre.createdAt,
    });
  });

  return { restored: true, preRestoreBackup: pre.fileName, ...counts };
}

/** Abre o banco atual e executa uma checagem simples (usado pelo /health). */
export function checkDatabase(db: Db): boolean {
  const row = db.get<{ ok: number }>("SELECT 1 AS ok");
  return row?.ok === 1;
}
