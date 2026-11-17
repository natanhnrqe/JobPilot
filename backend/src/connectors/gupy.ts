/**
 * Conector Gupy — portal público de vagas das empresas (Fase 6.7).
 *
 * Verificado em 2026-11-16 (ver docs/FONTES.md):
 * - `GET https://portal.gupy.io/api/job-search/jobs?jobName=estágio&limit=100&offset=0`
 *   devolve `{ data: [...], pagination: { total, limit, offset } }` sem chave;
 * - filtros no servidor: `jobName`, `city`, `state` e `workplaceType`
 *   (`remote`/`hybrid`/`on-site`);
 * - cada vaga traz `id`, `name`, `description`, `careerPageName` (empresa),
 *   `careerPageUrl`, `type` (`vacancy_type_internship`, `vacancy_type_talent_pool`,
 *   `vacancy_type_apprentice`…), `publishedDate`, `workplaceType`, `city`,
 *   `state` e `jobUrl`;
 * - é o portal da própria empresa (página de carreiras Gupy), por isso a vaga
 *   costuma aparecer aqui antes de chegar aos agregadores;
 * - `vacancy_type_talent_pool` não é vaga aberta (banco de talentos) e é
 *   descartado; `vacancy_type_internship` vira `contractType: "internship"`.
 *
 * Escopo: Curitiba (e região metropolitana) e vagas remotas no Brasil — o
 * mesmo recorte das demais fontes. A área e o tipo de contrato continuam sendo
 * filtrados pelo serviço de coleta (`matchesArea` + preferências).
 *
 * Nenhum login, CAPTCHA ou candidatura: o conector só lê a listagem pública.
 */

import { htmlToText } from "../fetch/htmlText.js";
import { fetchJson, type FetchJsonOptions } from "./http.js";
import type { ConnectorContext, RawJob, SourceConnector } from "./types.js";
import { SourceError } from "./types.js";

const DEFAULT_BASE_URL = "https://portal.gupy.io";
/** A API aceita até 100 por página; 100 cobre Curitiba/remoto em 1 página. */
const DEFAULT_PAGE_SIZE = 100;
/** Teto de páginas por consulta (protege contra um total inesperado). */
const DEFAULT_MAX_PAGES = 5;
/** `jobName` aceita acento; a API normaliza a busca. */
const DEFAULT_JOB_NAME = "estágio";

export interface GupyQuery {
  /** Busca textual no título (ex.: `estágio`). */
  jobName: string;
  /** Cidade exata (ex.: `Curitiba`). */
  city?: string;
  /** Estado (ex.: `Paraná`). */
  state?: string;
  /** Modalidade informada pela empresa. */
  workplaceType?: "remote" | "hybrid" | "on-site";
}

const DEFAULT_QUERIES: GupyQuery[] = [
  { jobName: DEFAULT_JOB_NAME, city: "Curitiba" },
  { jobName: DEFAULT_JOB_NAME, workplaceType: "remote" },
];

interface GupyJob {
  id?: number | string;
  name?: string;
  description?: string;
  careerPageName?: string;
  careerPageUrl?: string;
  type?: string;
  publishedDate?: string | null;
  workplaceType?: string | null;
  city?: string | null;
  state?: string | null;
  jobUrl?: string;
  applicationDeadline?: string | null;
}

interface GupyPayload {
  data?: unknown;
  pagination?: { total?: number; limit?: number; offset?: number };
}

export interface GupyOptions {
  /** Somente testes: aponta para um servidor local. */
  baseUrl?: string;
  /** Consultas por execução (padrão: Curitiba + remoto). */
  queries?: GupyQuery[];
  /** Vagas por página (padrão 100). */
  pageSize?: number;
  /** Teto de páginas por consulta (padrão 5). */
  maxPages?: number;
  fetchOptions?: FetchJsonOptions;
}

export class GupyConnector implements SourceConnector {
  readonly key = "gupy";
  readonly name = "Gupy (portal da empresa)";
  readonly kind = "api" as const;
  readonly supportState = "verified" as const;
  /** Duas consultas de uma página cabem no padrão de 30 s. */
  readonly timeoutMs = 45_000;

  constructor(private readonly options: GupyOptions = {}) {}

  private get baseUrl(): string {
    return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private get queries(): GupyQuery[] {
    return (this.options.queries ?? DEFAULT_QUERIES).filter((query) => query.jobName.trim() !== "");
  }

  private get pageSize(): number {
    return Math.max(1, Math.min(100, Math.trunc(this.options.pageSize ?? DEFAULT_PAGE_SIZE)));
  }

  private get maxPages(): number {
    return Math.max(1, Math.trunc(this.options.maxPages ?? DEFAULT_MAX_PAGES));
  }

  private async loadPage(
    query: GupyQuery,
    offset: number,
    limit: number,
  ): Promise<{ jobs: GupyJob[]; total: number }> {
    const url = new URL(`${this.baseUrl}/api/job-search/jobs`);
    url.searchParams.set("jobName", query.jobName);
    if (query.city) url.searchParams.set("city", query.city);
    if (query.state) url.searchParams.set("state", query.state);
    if (query.workplaceType) url.searchParams.set("workplaceType", query.workplaceType);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const payload = await fetchJson<GupyPayload>(url.toString(), this.options.fetchOptions);

    if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) {
      throw new SourceError(
        "parse_error",
        "O portal Gupy devolveu uma resposta inesperada (sem lista de vagas).",
      );
    }

    const total = typeof payload.pagination?.total === "number" ? payload.pagination.total : 0;
    return { jobs: payload.data as GupyJob[], total };
  }

  async verify(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const first = this.queries[0];
      if (!first) return { ok: false, reason: "Nenhuma consulta configurada para a Gupy." };
      // Lista vazia é resposta válida; o que importa é o formato.
      await this.loadPage(first, 0, 1);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async *fetch(ctx: ConnectorContext): AsyncIterable<RawJob> {
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    let received = 0;
    let accepted = 0;

    for (const query of this.queries) {
      if (ctx.signal.aborted) return;
      if (accepted >= ctx.maxJobs) break;

      for (let page = 0; page < this.maxPages; page++) {
        if (ctx.signal.aborted) return;
        if (accepted >= ctx.maxJobs) break;

        const offset = page * this.pageSize;
        const { jobs, total } = await this.loadPage(query, offset, this.pageSize);
        received += jobs.length;

        for (const job of jobs) {
          if (ctx.signal.aborted) break;
          if (accepted >= ctx.maxJobs) break;

          // Banco de talentos/aprendiz não é vaga de estágio aberta.
          if (job.type && job.type !== "vacancy_type_internship") continue;

          const raw = toRawJob(job);
          if (!raw) continue;
          if (raw.externalId && seenIds.has(raw.externalId)) continue;
          if (seenUrls.has(raw.sourceUrl)) continue;

          if (raw.externalId) seenIds.add(raw.externalId);
          seenUrls.add(raw.sourceUrl);

          accepted++;
          yield raw;
        }

        // Última página quando o total foi coberto ou a página veio incompleta.
        if (jobs.length === 0 || offset + jobs.length >= total) break;
      }
    }

    ctx.logger.log("info", "fetch", `Gupy: ${received} vagas recebidas, ${accepted} aceitas`, {
      consultas: this.queries.length,
      pagina: this.pageSize,
    });
  }
}

function toRawJob(job: GupyJob): RawJob | null {
  const sourceUrl = text(job.jobUrl);
  const title = text(job.name);
  if (!sourceUrl || !title) return null;

  return {
    externalId: job.id !== undefined && job.id !== null ? String(job.id) : undefined,
    sourceUrl,
    title,
    company: text(job.careerPageName),
    location: resolveLocation(job),
    workMode: resolveWorkMode(job),
    contractType: job.type === "vacancy_type_internship" ? "internship" : "unknown",
    salaryText: undefined,
    descriptionText: htmlToText(job.description ?? ""),
    postedAt: toIsoDate(job.publishedDate),
    raw: job,
  };
}

function resolveLocation(job: GupyJob): string | undefined {
  const city = text(job.city);
  const state = text(job.state);
  if (city && state) return `${city} - ${state}`;
  return city ?? state;
}

function resolveWorkMode(job: GupyJob): RawJob["workMode"] {
  const value = normalize(job.workplaceType ?? "");
  if (value === "remote") return "remote";
  if (value === "hybrid") return "hybrid";
  if (value === "on-site" || value === "onsite") return "onsite";
  return "unknown";
}

/**
 * `publishedDate` vem em ISO com fuso ("2026-11-16T21:42:56.686Z"). Data
 * inválida fica indefinida; nunca usamos a data atual.
 */
function toIsoDate(value: string | null | undefined): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
