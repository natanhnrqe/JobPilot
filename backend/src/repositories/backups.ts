import type { Db } from "../db/connection.js";

export interface BackupRow {
  id: number;
  file_name: string;
  size_bytes: number | null;
  kind: string;
  created_at: string;
}

export function insertBackupRow(
  db: Db,
  data: { fileName: string; sizeBytes: number; kind: "manual" | "pre_restore"; createdAt: string },
): number {
  const result = db.run(
    `INSERT INTO backups (file_name, size_bytes, kind, created_at) VALUES (?, ?, ?, ?)`,
    [data.fileName, data.sizeBytes, data.kind, data.createdAt],
  );
  return Number(result.lastInsertRowid);
}

export function getBackupRow(db: Db, fileName: string): BackupRow | undefined {
  return db.get<BackupRow>("SELECT * FROM backups WHERE file_name = ?", [fileName]);
}

/** Insere o registro se ainda não existir (usado na reconciliação pós-restauração). */
export function ensureBackupRow(
  db: Db,
  data: { fileName: string; sizeBytes: number; kind: "manual" | "pre_restore"; createdAt: string },
): void {
  db.run(
    `INSERT OR IGNORE INTO backups (file_name, size_bytes, kind, created_at) VALUES (?, ?, ?, ?)`,
    [data.fileName, data.sizeBytes, data.kind, data.createdAt],
  );
}

export function listBackupRows(db: Db): BackupRow[] {
  return db.all<BackupRow>("SELECT * FROM backups ORDER BY created_at DESC, id DESC");
}

export function listBackupFileNames(db: Db): string[] {
  return db.all<{ file_name: string }>("SELECT file_name FROM backups").map((r) => r.file_name);
}
