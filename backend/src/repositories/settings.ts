import type { Db } from "../db/connection.js";

export interface SettingDto {
  key: string;
  value: unknown;
  updatedAt: string;
}

function getRow(db: Db, key: string): { value: string; updated_at: string } | undefined {
  return db.get<{ value: string; updated_at: string }>(
    "SELECT value, updated_at FROM settings WHERE key = ?",
    [key],
  );
}

export function getSetting(db: Db, key: string): unknown {
  const row = getRow(db, key);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(db: Db, key: string, value: unknown): void {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value ?? null), new Date().toISOString()],
  );
}

export function getAllSettings(db: Db): SettingDto[] {
  return db
    .all<{ key: string; value: string; updated_at: string }>(
      "SELECT key, value, updated_at FROM settings ORDER BY key",
    )
    .map((row) => ({
      key: row.key,
      value: safeParse(row.value),
      updatedAt: row.updated_at,
    }));
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
