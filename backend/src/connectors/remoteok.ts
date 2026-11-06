/**
 * Conector Remote OK (Fase 2 — verificado em 2026-11-04, ver docs/FONTES.md).
 *
 * Fatos verificados sobre a API:
 * - `GET https://remoteok.com/api` devolve um ARRAY cujo primeiro elemento é o
 *   aviso legal (`{ last_updated, legal }`) e os demais são vagas;
 * - os parâmetros de consulta (`?tags=`, `?tag=`) são IGNORADOS: a resposta é
 *   sempre o mesmo lote (~100 vagas mais recentes, todas as áreas);
 * - filtro por `tags` no cliente é pouco confiável (ex.: "Front End Developer"
 *   vem só com as tags ["front end", "other"]) — por isso NÃO filtramos e
 *   deixamos a triagem para o JobPilot;
 * - Remote OK não expõe campo de tipo/nível de contrato: `contractType` fica
 *   `unknown` (as `tags` não são fonte confiável para isso);
 * - `salary_min`/`salary_max` são números SEM moeda: são reproduzidos como
 *   números (sem inventar símbolo de moeda) quando informados;
 * - condições de uso: vincular de volta ao Remote OK (com `follow`, sem
 *   `nofollow`) e mencionar "Remote OK" como fonte; não usar o logo.
 *
 * Estratégia: `verify()` e `fetch()` compartilham um cache do payload em
 * memória (15 min), então uma execução de coleta custa UMA requisição.
 */

import { htmlToText } from "../fetch/htmlText.js";
import { fetchJson, type FetchJsonOptions } from "./http.js";
import type { ConnectorContext, RawJob, SourceConnector } from "./types.js";
import { SourceError } from "./types.js";

const DEFAULT_ENDPOINT = "https://remoteok.com/api";
const DEFAULT_TTL_MS = 15 * 60 * 1000;

interface RemoteOkJob {
  id?: string | number;
  slug?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: unknown;
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  apply_url?: string;
  url?: string;
}

export interface RemoteOkOptions {
  /** Somente testes: aponta para um servidor local. */
  endpoint?: string;
  /** TTL do cache do payload (padrão 15 min). */
  ttlMs?: number;
  fetchOptions?: FetchJsonOptions;
}

export class RemoteOkConnector implements SourceConnector {
  readonly key = "remoteok";
  readonly name = "Remote OK";
  readonly kind = "api" as const;
  readonly supportState = "verified" as const;

  private cache: { at: number; jobs: RemoteOkJob[] } | null = null;

  constructor(private readonly options: RemoteOkOptions = {}) {}

  /** Carrega o payload (com cache compartilhado entre verify e fetch). */
  private async load(): Promise<RemoteOkJob[]> {
    const ttl = this.options.ttlMs ?? DEFAULT_TTL_MS;
    if (this.cache && Date.now() - this.cache.at < ttl) return this.cache.jobs;

    const endpoint = this.options.endpoint ?? DEFAULT_ENDPOINT;
    const payload = await fetchJson<unknown>(endpoint, this.options.fetchOptions);
    if (!Array.isArray(payload)) {
      throw new SourceError(
        "parse_error",
        "A API do Remote OK devolveu uma resposta inesperada (não é uma lista).",
      );
    }
    // O primeiro elemento é o aviso legal; só entram objetos com `position`.
    const jobs = payload.filter(
      (item): item is RemoteOkJob =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RemoteOkJob).position === "string",
    );
    this.cache = { at: Date.now(), jobs };
    return jobs;
  }

  async verify(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const jobs = await this.load();
      if (jobs.length === 0) return { ok: false, reason: "A API respondeu sem vagas." };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async *fetch(ctx: ConnectorContext): AsyncIterable<RawJob> {
    const jobs = await this.load();

    let received = 0;
    let accepted = 0;
    for (const job of jobs) {
      if (ctx.signal.aborted) break;
      if (accepted >= ctx.maxJobs) break;
      received++;

      const raw = toRawJob(job);
      if (!raw) continue;

      accepted++;
      yield raw;
    }

    ctx.logger.log(
      "info",
      "fetch",
      `Remote OK: ${received} vagas recebidas, ${accepted} aceitas`,
      {},
    );
  }
}

/** Mapeia uma vaga bruta; devolve null quando faltam campos mínimos (url/título). */
function toRawJob(job: RemoteOkJob): RawJob | null {
  if (!job || typeof job.position !== "string") return null;

  const title = job.position.trim();
  const sourceUrl = textOrUndefined(job.url) ?? textOrUndefined(job.apply_url);
  if (!title || !sourceUrl) return null;

  return {
    externalId: job.id !== undefined && job.id !== null ? String(job.id) : undefined,
    sourceUrl,
    title,
    company: textOrUndefined(job.company),
    location: textOrUndefined(job.location),
    // O Remote OK é 100% remoto por definição.
    workMode: "remote",
    // Sem campo de tipo/nível confiável na fonte: não inventamos.
    contractType: "unknown",
    salaryText: formatSalary(job.salary_min, job.salary_max),
    descriptionText: typeof job.description === "string" ? htmlToText(job.description) : "",
    postedAt: toIsoUtc(job.date, job.epoch),
    raw: job,
  };
}

function textOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Monta o texto de salário só com o que a fonte informa (números, sem moeda).
 * Não adiciona símbolo nem moeda — o Remote OK não os informa.
 */
function formatSalary(min: unknown, max: unknown): string | undefined {
  const lo = typeof min === "number" && Number.isFinite(min) && min > 0 ? min : undefined;
  const hi = typeof max === "number" && Number.isFinite(max) && max > 0 ? max : undefined;
  if (lo === undefined && hi === undefined) return undefined;
  if (lo !== undefined && hi !== undefined) return lo === hi ? String(lo) : `${lo}–${hi}`;
  return String(lo ?? hi);
}

/**
 * `date` já vem em ISO com fuso (ex.: "2026-11-03T16:00:25+00:00"); `epoch`
 * (segundos) é o fallback. Data ilegível → undefined (nunca é inventada).
 */
function toIsoUtc(date: string | undefined, epoch: number | undefined): string | undefined {
  const trimmed = textOrUndefined(date);
  if (trimmed) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof epoch === "number" && Number.isFinite(epoch) && epoch > 0) {
    const parsed = new Date(epoch * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}
