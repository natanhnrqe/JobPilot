/**
 * Conector LinkedIn Job Search API (RapidAPI) — Fase 6.6.
 *
 * Verificado em 2026-11-14 (ver docs/RAPIDAPI.md e docs/FONTES.md):
 * - `GET /active-jb` devolve um ARRAY de vagas (não `{ data: ... }`);
 * - exige `X-RapidAPI-Key` e `X-RapidAPI-Host` (chave só no `.env`);
 * - o plano gratuito observado tem cota de **25 requisições e 250 vagas por
 *   mês** — por isso o conector faz no máximo 2 requisições por semana e usa
 *   cache em arquivo (sobrevive entre execuções do CLI) com TTL de 6 dias;
 * - `seniority` vem localizado ("Estágio") e `employment_type` pode ser
 *   `FULL_TIME` mesmo em estágio: o tipo é resolvido por seniority + título;
 * - `ai_salary_*` é estimativa de IA e NÃO é usado como salário (nada é
 *   inventado); só `salary` textual vira `salaryText`;
 * - os links abrem a vaga no LinkedIn: o JobPilot só lê a listagem pública.
 *   Nenhum login, CAPTCHA, candidatura ou envio automático.
 *
 * Não é uma API oficial: é raspagem de terceiros. Se responder 401/403/429, a
 * fonte falha isolada (`search_runs.status='partial'`) e as demais continuam.
 */

import fs from "node:fs";
import path from "node:path";
import { htmlToText } from "../fetch/htmlText.js";
import { fetchJson, type FetchJsonOptions } from "./http.js";
import type { ConnectorContext, RawJob, SourceConnector } from "./types.js";
import { SourceError } from "./types.js";

const DEFAULT_BASE_URL = "https://linkedin-job-search-api.p.rapidapi.com";
const DEFAULT_HOST = "linkedin-job-search-api.p.rapidapi.com";
const DEFAULT_TIME_FRAME = "7d";
/** 20 por consulta × 2 consultas ≈ 40 vagas/semana (dentro das 250/mês). */
const DEFAULT_LIMIT = 20;
/** Seis dias: uma coleta diária só chama a API uma vez por semana. */
const DEFAULT_TTL_MS = 6 * 24 * 60 * 60 * 1000;

const TITLE_QUERY = '"estágio" OR "estagiário"';

export interface LinkedInQuery {
  /** Busca textual no título (aceita a sintaxe `"a" OR "b"`). */
  title: string;
  /** Busca textual no local (aceita a sintaxe `"a" OR "b"`). */
  location: string;
  /** Filtro de arranjo de trabalho (ex.: `Remote OK,Remote Solely`). */
  workArrangement?: string;
}

const DEFAULT_QUERIES: LinkedInQuery[] = [
  { title: TITLE_QUERY, location: '"Curitiba"' },
  {
    title: TITLE_QUERY,
    location: '"Brazil"',
    workArrangement: "Remote OK,Remote Solely",
  },
];

interface LinkedInPlace {
  address?: {
    addressLocality?: string | null;
    addressRegion?: string | null;
    addressCountry?: string | null;
  };
}

interface LinkedInJob {
  id?: number | string;
  linkedin_id?: number | string;
  title?: string;
  organization?: string;
  url?: string;
  locations?: LinkedInPlace[];
  locations_derived?: string[];
  location_type?: string | null;
  employment_type?: string[] | null;
  seniority?: string | null;
  date_posted?: string | null;
  description_text?: string;
  salary?: unknown;
  ai_work_arrangement?: string | null;
}

export interface LinkedInJobsOptions {
  /** Somente testes: aponta para um servidor local. */
  baseUrl?: string;
  /** Chave do RapidAPI (obrigatória; só no `.env`). */
  apiKey?: string;
  /** Host do RapidAPI (padrão `linkedin-job-search-api.p.rapidapi.com`). */
  host?: string;
  /** Consultas executadas por coleta (padrão: Curitiba + remoto Brasil). */
  queries?: LinkedInQuery[];
  /** Janela da API: `24h`, `7d` ou `6m` (padrão `7d`). */
  timeFrame?: string;
  /** Vagas por consulta (padrão 20; a cota mensal é de 250 vagas). */
  limit?: number;
  /** TTL do cache (padrão 6 dias). */
  ttlMs?: number;
  /** Cache em arquivo para não gastar cota entre execuções do CLI. */
  cacheFile?: string;
  now?: () => number;
  fetchOptions?: FetchJsonOptions;
}

interface CacheEntry {
  at: number;
  jobs: LinkedInJob[];
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

export class LinkedInJobsConnector implements SourceConnector {
  readonly key = "rapidapi-linkedin";
  readonly name = "LinkedIn Jobs (RapidAPI)";
  readonly kind = "api" as const;
  readonly supportState = "verified" as const;
  /** Duas consultas de ~3 s cabem no padrão de 30 s; o teto protege a fonte. */
  readonly timeoutMs = 45_000;

  private readonly cache = new Map<string, CacheEntry>();
  private cacheLoaded = false;

  constructor(private readonly options: LinkedInJobsOptions = {}) {}

  private get baseUrl(): string {
    return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private get host(): string {
    return this.options.host ?? DEFAULT_HOST;
  }

  private get queries(): LinkedInQuery[] {
    return (this.options.queries ?? DEFAULT_QUERIES).filter(
      (query) => query.title.trim() !== "" && query.location.trim() !== "",
    );
  }

  private get timeFrame(): string {
    return this.options.timeFrame ?? DEFAULT_TIME_FRAME;
  }

  private get limit(): number {
    return Math.max(1, Math.min(1000, Math.trunc(this.options.limit ?? DEFAULT_LIMIT)));
  }

  private get ttlMs(): number {
    return this.options.ttlMs ?? DEFAULT_TTL_MS;
  }

  private apiKey(): string {
    const key = this.options.apiKey?.trim() ?? "";
    if (!key) {
      throw new SourceError(
        "unsupported",
        "RAPIDAPI_KEY não configurada: o conector LinkedIn fica desligado.",
      );
    }
    return key;
  }

  /** Carrega uma consulta (cache em memória + arquivo). */
  private async loadQuery(query: LinkedInQuery): Promise<LinkedInJob[]> {
    const key = this.cacheKey(query);
    this.loadCacheFile();

    const cached = this.cache.get(key);
    const now = this.options.now?.() ?? Date.now();
    if (cached && now - cached.at < this.ttlMs) return cached.jobs;

    const url = new URL(`${this.baseUrl}/active-jb`);
    url.searchParams.set("time_frame", this.timeFrame);
    url.searchParams.set("limit", String(this.limit));
    url.searchParams.set("offset", "0");
    url.searchParams.set("description_format", "text");
    url.searchParams.set("title", query.title);
    url.searchParams.set("location", query.location);
    if (query.workArrangement) {
      url.searchParams.set("ai_work_arrangement", query.workArrangement);
    }

    const payload = await fetchJson<unknown>(url.toString(), {
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
        "O LinkedIn Jobs devolveu uma resposta inesperada (sem lista de vagas).",
      );
    }

    this.cache.set(key, { at: now, jobs });
    this.saveCacheFile();
    return jobs;
  }

  async verify(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const first = this.queries[0];
      if (!first) return { ok: false, reason: "Nenhuma consulta configurada para o LinkedIn." };
      // Lista vazia é resposta válida (semana sem estágio novo); o que importa
      // é a API ter respondido no formato esperado.
      await this.loadQuery(first);
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

    ctx.logger.log("info", "fetch", `LinkedIn: ${received} vagas recebidas, ${accepted} aceitas`, {
      consultas: this.queries.length,
      janela: this.timeFrame,
      limitePorConsulta: this.limit,
    });
  }

  private cacheKey(query: LinkedInQuery): string {
    return JSON.stringify([
      query.title,
      query.location,
      query.workArrangement ?? "",
      this.timeFrame,
      this.limit,
    ]);
  }

  /** Lê o cache em arquivo uma única vez; arquivo inválido é ignorado. */
  private loadCacheFile(): void {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;

    const file = this.options.cacheFile;
    if (!file) return;

    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CacheFile;
      if (parsed?.version !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
        return;
      }
      for (const [key, entry] of Object.entries(parsed.entries)) {
        if (
          entry &&
          typeof entry.at === "number" &&
          Array.isArray(entry.jobs) &&
          entry.jobs.every((job) => typeof job === "object" && job !== null)
        ) {
          this.cache.set(key, entry);
        }
      }
    } catch {
      // Sem cache (ou corrompido): segue para a API.
    }
  }

  /** Grava o cache de forma atômica; falha de escrita nunca derruba a coleta. */
  private saveCacheFile(): void {
    const file = this.options.cacheFile;
    if (!file) return;

    const data: CacheFile = { version: 1, entries: Object.fromEntries(this.cache) };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
      fs.renameSync(tmp, file);
    } catch {
      // Cache é otimização de cota; a coleta continua sem ele.
    }
  }
}

/** A API devolve um array; `{ jobs: [...] }` é aceito por resiliência. */
function extractJobs(payload: unknown): LinkedInJob[] | null {
  if (Array.isArray(payload)) return payload as LinkedInJob[];
  if (payload && typeof payload === "object") {
    const jobs = (payload as { jobs?: unknown }).jobs;
    if (Array.isArray(jobs)) return jobs as LinkedInJob[];
  }
  return null;
}

function toRawJob(job: LinkedInJob): RawJob | null {
  const sourceUrl = text(job.url);
  const title = text(job.title);
  if (!sourceUrl || !title) return null;

  const externalId =
    job.id !== undefined && job.id !== null
      ? String(job.id)
      : job.linkedin_id !== undefined && job.linkedin_id !== null
        ? String(job.linkedin_id)
        : undefined;

  return {
    externalId,
    sourceUrl,
    title,
    company: text(job.organization),
    location: resolveLocation(job),
    workMode: resolveWorkMode(job),
    contractType: resolveContractType(job),
    salaryText: text(job.salary),
    descriptionText: htmlToText(job.description_text ?? ""),
    postedAt: toIsoDate(job.date_posted),
    raw: job,
  };
}

/** Usa o local normalizado pela API; se faltar, monta cidade/estado/país. */
function resolveLocation(job: LinkedInJob): string | undefined {
  const derived = job.locations_derived?.map((value) => value.trim()).filter((v) => v !== "");
  if (derived && derived.length > 0) return derived[0];

  const address = job.locations?.[0]?.address;
  if (!address) return undefined;
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value !== "");
  return parts.length > 0 ? parts.join(" - ") : undefined;
}

function resolveWorkMode(job: LinkedInJob): RawJob["workMode"] {
  const arrangement = normalize(job.ai_work_arrangement ?? "");
  if (arrangement.includes("remote")) return "remote";
  if (arrangement.includes("hybrid")) return "hybrid";
  if (arrangement.includes("on-site") || arrangement.includes("onsite")) return "onsite";

  if (normalize(job.location_type ?? "") === "telecommute") return "remote";

  const location = resolveLocation(job);
  if (!location) return "unknown";
  if (/remot|home office/.test(normalize(location))) return "remote";
  return "onsite";
}

/**
 * `seniority` localizado ("Estágio") é a fonte mais confiável; o título cobre
 * os casos em que o campo vem nulo. `employment_type` pode ser FULL_TIME mesmo
 * em estágio, então não é usado sozinho.
 */
function resolveContractType(job: LinkedInJob): RawJob["contractType"] {
  const candidates = [job.seniority, job.title, ...(job.employment_type ?? [])];
  return candidates.some((value) => isInternshipText(value)) ? "internship" : "unknown";
}

function isInternshipText(value: string | null | undefined): boolean {
  return /estagi|\bintern(?:ship)?\b|trainee/.test(normalize(value ?? ""));
}

/**
 * `date_posted` vem sem fuso ("2026-11-13T17:44:55"). A API trata os horários
 * como UTC; sem fuso explícito, acrescentamos `Z` em vez de assumir o fuso
 * local. Data inválida fica indefinida (nunca inventada).
 */
function toIsoDate(value: string | null | undefined): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const date = new Date(hasTimezone ? raw : `${raw}Z`);
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
