/**
 * Conector JSearch (RapidAPI) — Fase 6.2 (verificado em 2026-11-10 e 2026-11-13,
 * ver docs/FONTES.md e docs/RAPIDAPI.md).
 *
 * Fatos verificados sobre a API:
 * - `GET /search-v2` devolve `{ status, request_id, parameters, data: { jobs: [...] } }`.
 *   O endpoint antigo `/search` responde `404 Endpoint '/search' does not exist`;
 * - exige os cabeçalhos `X-RapidAPI-Key` e `X-RapidAPI-Host` (chave só no `.env`);
 * - cota gratuita observada: 200 requisições/mês — por isso cada consulta usa
 *   `num_pages=1` e o payload fica em cache por 15 min (verify + fetch = 1/env);
 * - `job_employment_type` vem localizado em português ("Estágio", "Meio período",
 *   "Tempo integral"…), não como `INTERN`: o tipo é normalizado pelo texto;
 * - `job_posted_at_datetime_utc` pode vir nulo — nesse caso a data fica indefinida;
 * - os links levam ao portal de origem (Catho, Indeed, TOTVS…): o JobPilot só
 *   abre a página; nenhum login, CAPTCHA ou candidatura automática.
 *
 * Não é uma API oficial: é raspagem de terceiros. Se responder 401/403/429, a
 * fonte falha de forma isolada (`search_runs.status='partial'`) e as demais seguem.
 */

import { htmlToText } from "../fetch/htmlText.js";
import { fetchJson, type FetchJsonOptions } from "./http.js";
import type { ConnectorContext, RawJob, SourceConnector } from "./types.js";
import { SourceError } from "./types.js";

const DEFAULT_BASE_URL = "https://jsearch.p.rapidapi.com";
const DEFAULT_HOST = "jsearch.p.rapidapi.com";
const DEFAULT_COUNTRY = "br";
const DEFAULT_DATE_POSTED = "month";
const DEFAULT_TTL_MS = 15 * 60 * 1000;
/** Duas consultas por execução (~60/mês numa coleta diária, dentro da cota de 200). */
const DEFAULT_QUERIES = ["estágio Curitiba", "estágio remoto Brasil"];

interface JsearchJob {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_employment_type?: string;
  job_is_remote?: boolean;
  job_description?: string;
  job_apply_link?: string;
  job_google_link?: string;
  job_salary_string?: string;
  job_posted_at_datetime_utc?: string | null;
}

interface JsearchResponse {
  status?: string;
  data?: { jobs?: JsearchJob[] } | JsearchJob[];
}

export interface JSearchOptions {
  /** Somente testes: aponta para um servidor local. */
  baseUrl?: string;
  /** Chave do RapidAPI (obrigatória; só no `.env`). */
  apiKey?: string;
  /** Host do RapidAPI (padrão `jsearch.p.rapidapi.com`). */
  host?: string;
  /** Consultas executadas por coleta (padrão: Curitiba + remoto). */
  queries?: string[];
  country?: string;
  datePosted?: string;
  /** TTL do cache por consulta (padrão 15 min). */
  ttlMs?: number;
  now?: () => Date;
  fetchOptions?: FetchJsonOptions;
}

interface CacheEntry {
  at: number;
  jobs: JsearchJob[];
}

export class JSearchConnector implements SourceConnector {
  readonly key = "rapidapi-jsearch";
  readonly name = "JSearch (RapidAPI)";
  readonly kind = "api" as const;
  readonly supportState = "verified" as const;
  /** Duas consultas de ~5 s cabem no padrão de 30 s, mas o teto protege a fonte. */
  readonly timeoutMs = 45_000;

  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly options: JSearchOptions = {}) {}

  private get baseUrl(): string {
    return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private get host(): string {
    return this.options.host ?? DEFAULT_HOST;
  }

  private get queries(): string[] {
    const queries = this.options.queries ?? DEFAULT_QUERIES;
    return queries.map((q) => q.trim()).filter((q) => q !== "");
  }

  private apiKey(): string {
    const key = this.options.apiKey?.trim() ?? "";
    if (!key) {
      throw new SourceError(
        "unsupported",
        "RAPIDAPI_KEY não configurada: o conector JSearch fica desligado.",
      );
    }
    return key;
  }

  /** Carrega uma consulta (com cache). Falha de rede/parse vira `SourceError`. */
  private async loadQuery(query: string): Promise<JsearchJob[]> {
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.at < (this.options.ttlMs ?? DEFAULT_TTL_MS)) {
      return cached.jobs;
    }

    const url = new URL(`${this.baseUrl}/search-v2`);
    url.searchParams.set("query", query);
    url.searchParams.set("page", "1");
    url.searchParams.set("num_pages", "1");
    url.searchParams.set("country", this.options.country ?? DEFAULT_COUNTRY);
    url.searchParams.set("date_posted", this.options.datePosted ?? DEFAULT_DATE_POSTED);

    const payload = await fetchJson<JsearchResponse>(url.toString(), {
      ...this.options.fetchOptions,
      headers: {
        ...this.options.fetchOptions?.headers,
        "X-RapidAPI-Key": this.apiKey(),
        "X-RapidAPI-Host": this.host,
      },
    });

    const jobs = extractJobs(payload);
    if (!jobs) {
      throw new SourceError(
        "parse_error",
        "O JSearch devolveu uma resposta inesperada (sem lista de vagas).",
      );
    }

    this.cache.set(query, { at: Date.now(), jobs });
    return jobs;
  }

  async verify(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const first = this.queries[0];
      if (!first) return { ok: false, reason: "Nenhuma consulta configurada para o JSearch." };
      const jobs = await this.loadQuery(first);
      if (jobs.length === 0) return { ok: false, reason: "A API respondeu sem vagas." };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async *fetch(ctx: ConnectorContext): AsyncIterable<RawJob> {
    // A chave é validada antes de qualquer requisição: sem ela, nada é enviado.
    this.apiKey();

    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    let received = 0;
    let accepted = 0;

    for (const query of this.queries) {
      if (ctx.signal.aborted) return;
      if (accepted >= ctx.maxJobs) break;

      const jobs = await this.loadQuery(query);
      received += jobs.length;

      for (const job of jobs) {
        if (ctx.signal.aborted) break;
        if (accepted >= ctx.maxJobs) break;

        const raw = toRawJob(job);
        if (!raw) continue;
        if (raw.externalId && seenIds.has(raw.externalId)) continue;
        if (seenUrls.has(raw.sourceUrl)) continue;

        if (raw.externalId) seenIds.add(raw.externalId);
        seenUrls.add(raw.sourceUrl);

        accepted++;
        yield raw;
      }
    }

    ctx.logger.log("info", "fetch", `JSearch: ${received} vagas recebidas, ${accepted} aceitas`, {
      consultas: this.queries.length,
    });
  }
}

/** Aceita tanto `data.jobs` (formato atual) quanto `data[]` (formato antigo). */
function extractJobs(payload: JsearchResponse | null | undefined): JsearchJob[] | null {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.jobs)) return data.jobs;
  return null;
}

function toRawJob(job: JsearchJob): RawJob | null {
  const sourceUrl = textOrUndefined(job.job_apply_link) ?? textOrUndefined(job.job_google_link);
  const title = textOrUndefined(job.job_title);
  if (!sourceUrl || !title) return null;

  return {
    externalId: textOrUndefined(job.job_id),
    sourceUrl,
    title,
    company: textOrUndefined(job.employer_name),
    location: resolveLocation(job),
    workMode: job.job_is_remote === true ? "remote" : "onsite",
    contractType: resolveContractType(job),
    salaryText: textOrUndefined(job.job_salary_string),
    descriptionText: htmlToText(job.job_description ?? ""),
    postedAt: toIsoDate(job.job_posted_at_datetime_utc),
    raw: job,
  };
}

/** "Curitiba - PR"; só o que a fonte informa, sem inventar bairro/país. */
function resolveLocation(job: JsearchJob): string | undefined {
  const city = textOrUndefined(job.job_city);
  const state = textOrUndefined(job.job_state);
  if (city && state && city.toLowerCase() !== state.toLowerCase()) return `${city} - ${state}`;
  return city ?? state;
}

/**
 * O campo vem localizado ("Estágio", "Meio período"…). Só marca `internship`
 * quando o texto do tipo OU o título indica estágio; o resto fica `unknown`
 * (a coleta ainda infere o nível pelo título).
 */
function resolveContractType(job: JsearchJob): RawJob["contractType"] {
  if (isInternshipText(job.job_employment_type)) return "internship";
  if (isInternshipText(job.job_title)) return "internship";
  return "unknown";
}

function isInternshipText(value: string | undefined): boolean {
  // O texto é normalizado (sem acento), então "estagi" cobre estágio/estagiário.
  const text = normalize(value);
  return /estagi|\bintern\b|trainee/.test(text);
}

/** `job_posted_at_datetime_utc` nulo ou ilegível → undefined (nunca inventado). */
function toIsoDate(value: string | null | undefined): string | undefined {
  const text = textOrUndefined(value);
  if (!text) return undefined;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function textOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
