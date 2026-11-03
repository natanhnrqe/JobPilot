import fs from "node:fs";
import path from "node:path";
import { Db } from "./connection.js";
import { runMigrations } from "./migrate.js";
import type { AppConfig } from "../config/index.js";
import type { Logger } from "../logging/logger.js";

/**
 * Mantém a conexão com o banco. A restauração substitui o arquivo do banco,
 * portanto a conexão precisa poder ser reaberta (swap).
 */
export class DbHolder {
  private db: Db | null = null;
  private migrationsDone = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  /** Abre o banco (se necessário) e garante as migrações aplicadas. */
  get(): Db {
    if (!this.db) {
      fs.mkdirSync(path.dirname(this.config.databasePath), { recursive: true });
      this.db = new Db(this.config.databasePath);
      if (!this.migrationsDone) {
        const migrationsDir = path.join(this.config.backendDir, "migrations");
        const applied = runMigrations(this.db, migrationsDir);
        if (applied.length > 0) {
          this.logger.info("Migrações aplicadas", { arquivos: applied });
        }
        this.migrationsDone = true;
      }
    }
    return this.db;
  }

  /**
   * Substitui o arquivo do banco por `sourceFile` e reabre a conexão.
   * Usado pela restauração de backup.
   */
  swapDatabaseFile(sourceFile: string): void {
    const current = this.db;
    if (current) {
      current.close();
      this.db = null;
    }
    // Copia o backup por cima do banco principal.
    fs.copyFileSync(sourceFile, this.config.databasePath);
    // Remover resquícios de WAL do banco anterior.
    for (const suffix of ["-wal", "-shm"]) {
      const side = this.config.databasePath + suffix;
      if (fs.existsSync(side)) fs.unlinkSync(side);
    }
    this.get();
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
