import { toCsv, type CsvValue } from "../domain/csv.js";
import type { Db } from "../db/connection.js";
import type { ServiceContext } from "./context.js";

/**
 * Exportação do histórico consolidado (Fase 5.3).
 *
 * Inclui registros excluídos (soft delete) para preservar o histórico; a coluna
 * `deleted_at` deixa claro o que foi removido. Nada aqui altera o banco.
 */

export const EXPORT_ENTITIES = ["jobs", "applications", "events"] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

export const EXPORT_FORMATS = ["csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportResult {
  entity: ExportEntity;
  format: ExportFormat;
  fileName: string;
  contentType: string;
  body: string;
}

interface ExportDefinition {
  headers: string[];
  select(db: Db): Array<Record<string, CsvValue>>;
}

const definitions: Record<ExportEntity, ExportDefinition> = {
  jobs: {
    headers: [
      "id",
      "title",
      "company",
      "location",
      "work_mode",
      "contract_type",
      "salary_text",
      "source_url",
      "posted_at",
      "discovered_at",
      "status",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
    select(db) {
      return db.all(
        `SELECT j.id, j.title, j.company, j.location, j.work_mode, j.contract_type,
                j.salary_text, j.source_url, j.posted_at, j.discovered_at, j.status,
                j.created_at, j.updated_at, j.deleted_at
           FROM jobs j
          ORDER BY j.id ASC`,
      );
    },
  },
  applications: {
    headers: [
      "id",
      "job_id",
      "job_title",
      "company",
      "status",
      "status_changed_at",
      "applied_at",
      "portal_key",
      "evidence_url",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
    select(db) {
      return db.all(
        `SELECT a.id, a.job_id, j.title AS job_title, j.company, a.status,
                a.status_changed_at, a.applied_at, a.portal_key, a.evidence_url,
                a.created_at, a.updated_at, a.deleted_at
           FROM applications a
           JOIN jobs j ON j.id = a.job_id
          ORDER BY a.id ASC`,
      );
    },
  },
  events: {
    headers: [
      "id",
      "created_at",
      "type",
      "actor",
      "job_id",
      "job_title",
      "application_id",
      "from_value",
      "to_value",
      "message",
    ],
    select(db) {
      return db.all(
        `SELECT e.id, e.created_at, e.type, e.actor, e.job_id,
                j.title AS job_title, e.application_id, e.from_value, e.to_value, e.message
           FROM events e
           LEFT JOIN jobs j ON j.id = e.job_id
          ORDER BY e.id ASC`,
      );
    },
  },
};

function localDateStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function exportData(
  ctx: ServiceContext,
  entity: ExportEntity,
  format: ExportFormat,
  now = new Date(),
): ExportResult {
  const definition = definitions[entity];
  const rows = definition.select(ctx.holder.get());
  const stamp = localDateStamp(now);
  const fileName = `jobpilot-${entity}-${stamp}.${format}`;

  if (format === "json") {
    return {
      entity,
      format,
      fileName,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(
        {
          exportedAt: now.toISOString(),
          entity,
          count: rows.length,
          items: rows,
        },
        null,
        2,
      ),
    };
  }

  const csvRows = rows.map((row) => definition.headers.map((header) => row[header]));
  return {
    entity,
    format,
    fileName,
    contentType: "text/csv; charset=utf-8",
    // BOM para o Excel reconhecer UTF-8 e exibir acentos corretamente.
    body: `\uFEFF${toCsv(definition.headers, csvRows)}`,
  };
}
