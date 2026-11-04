/**
 * Normalização e detecção de duplicatas (Seção 6.2 da especificação).
 * A IA nunca define identificadores nem status — a detecção de duplicidade
 * é feita aqui, a partir de dados já persistidos, e a decisão final é do usuário.
 */

import type { Db } from "../db/connection.js";
import type { JobRow } from "../repositories/jobs.js";

/** Normaliza uma URL para comparação: lowercase no host, sem hash, sem utm_*, sem "/" final. */
export function normalizeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    const path = url.pathname.replace(/\/+$/, "");
    const query = url.searchParams.toString();
    return `${url.protocol}//${url.hostname}${path}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

/** Normaliza texto só para comparação (sem acentos, pontuação ou caixa). */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface DuplicateCandidate {
  id: number;
  title: string;
  company: string | null;
  status: string;
  sourceUrl: string | null;
  reason: "url" | "empresa+titulo";
}

/**
 * Procura possíveis duplicatas de uma vaga candidata.
 * - por URL normalizada (forte);
 * - por empresa + título normalizados (apenas INDÍCIO — podem ser vagas
 *   diferentes; nunca descarta automaticamente).
 */
export function findPossibleDuplicates(
  db: Db,
  candidate: {
    sourceUrl?: string | null;
    title?: string | null;
    company?: string | null;
    excludeJobId?: number;
  },
): DuplicateCandidate[] {
  const results = new Map<number, DuplicateCandidate>();

  const normalizedUrl = candidate.sourceUrl ? normalizeUrl(candidate.sourceUrl) : null;
  if (normalizedUrl) {
    const rows = db.all<JobRow>(
      "SELECT * FROM jobs WHERE deleted_at IS NULL AND source_url IS NOT NULL LIMIT 2000",
    );
    for (const row of rows) {
      const rowUrl = row.source_url ? normalizeUrl(row.source_url) : null;
      if (rowUrl && rowUrl === normalizedUrl && row.id !== candidate.excludeJobId) {
        results.set(row.id, {
          id: row.id,
          title: row.title,
          company: row.company,
          status: row.status,
          sourceUrl: row.source_url,
          reason: "url",
        });
      }
    }
  }

  if (candidate.title && candidate.company) {
    // Comparação normalizada (sem acentos/pontuação) em JS — volume é pequeno.
    const titleNorm = normalizeText(candidate.title);
    const companyNorm = normalizeText(candidate.company);
    for (const row of db.all<JobRow>(
      "SELECT * FROM jobs WHERE deleted_at IS NULL AND company IS NOT NULL LIMIT 2000",
    )) {
      if (row.id === candidate.excludeJobId) continue;
      if (
        normalizeText(row.title) === titleNorm &&
        normalizeText(row.company ?? "") === companyNorm
      ) {
        if (!results.has(row.id)) {
          results.set(row.id, {
            id: row.id,
            title: row.title,
            company: row.company,
            status: row.status,
            sourceUrl: row.source_url,
            reason: "empresa+titulo",
          });
        }
      }
    }
  }

  return [...results.values()];
}
