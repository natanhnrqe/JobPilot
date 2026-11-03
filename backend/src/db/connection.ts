import { DatabaseSync } from "node:sqlite";

export type SqlParam = string | number | bigint | null | Uint8Array;

export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

/**
 * Wrapper fino sobre node:sqlite (DatabaseSync).
 * A API é síncrona: adequada para uso local (arquivo único, WAL).
 */
export class Db {
  private readonly db: DatabaseSync;

  constructor(public readonly path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    this.db.exec("PRAGMA busy_timeout=5000;");
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: SqlParam[] = []): RunResult {
    return this.db.prepare(sql).run(...params);
  }

  get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /**
   * Executa `fn` dentro de uma transação (BEGIN IMMEDIATE ... COMMIT).
   * Em caso de erro, faz ROLLBACK e repropaga.
   */
  withTransaction<T>(fn: () => T): T {
    this.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.exec("ROLLBACK");
      } catch {
        // Se o ROLLBACK falhar, o erro original ainda é o mais relevante.
      }
      throw err;
    }
  }

  /** Força o conteúdo do WAL para o arquivo principal (antes de copiar/fechar). */
  checkpoint(): void {
    this.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }

  close(): void {
    this.checkpoint();
    this.db.close();
  }
}
