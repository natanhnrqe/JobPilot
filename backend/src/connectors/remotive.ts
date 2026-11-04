/**
 * Conector Remotive (Fase 2 — verificado em 2026-11-03, ver docs/FONTES.md).
 *
 * Fatos verificados sobre a API:
 * - `GET https://remotive.com/api/remote-jobs` devolve `{ jobs: [...] }`;
 * - os parâmetros de consulta documentados (limit/category/search) são
 *   IGNORADOS pelo servidor: a resposta é sempre o mesmo lote de 10 vagas
 *   mais recentes (corpo idêntico, 161734 bytes) — por isso o filtro de
 *   categoria é feito no cliente;
 * - condições de uso: link para o Remotive e menção como fonte; sem envio a
 *   terceiros; ~4 requisições/dia sugeridas (mais de 2/min são bloqueadas).
 *
 * Estratégia: `verify()` e `fetch()` compartilham um cache do payload em
 * memória (15 min), então uma execução de coleta custa UMA requisição.
 */

import { htmlToText } from "../fetch/htmlText.js";
import { fetchJson, type FetchJsonOptions } from "./http.js";
import type { ConnectorContext, RawJob, SourceConnector } from "./types.js";
import { SourceError } from "./types.js";

const DEFAULT_ENDPOINT = "https://remotive.com/api/remote-jobs";
const DEFAULT_TTL_MS = 15 * 60 * 1000;
/** Filtro padrão: foco em desenvolvimento de software (a API ignora ?category=). */
const DEFAULT_CATEGORIES = ["Software Development"];

interface RemotiveJob {
  id?: number;
  url?: string;
  title?: string;
  company_name?: string;
  candidate_required_location?: string;
  category?: string;
  job_type?: string;
  publication_date?: string;
  salary?: string;
  description?: string;
}

interface RemotivePayload {
  jobs?: RemotiveJob[];
}

export interface RemotiveOptions {
  /** Somente testes: aponta para um servidor local. */
  endpoint?: string;
  /** Categorias aceitas (comparação sem distinção de maiúsculas). */
  categories?: string[];
  /** TTL do cache do payload (padrão 15 min). */
  ttlMs?: number;
  fetchOptions?: FetchJsonOptions;
}

export class RemotiveConnector implements SourceConnector {
  readonly key = "remotive";
  readonly name = "Remotive";
  readonly kind = "api" as const;
  readonly supportState = "verified" as const;

  private cache: { at: number; jobs: RemotiveJob[] } | null = null;

  constructor(private readonly options: RemotiveOptions = {}) {}

  /** Carrega o payload (com cache compartilhado entre verify e fetch). */
  private async load(): Promise<RemotiveJob[]> {
    const ttl = this.options.ttlMs ?? DEFAULT_TTL_MS;
    if (this.cache && Date.now() - this.cache.at < ttl) return this.cache.jobs;

    const endpoint = this.options.endpoint ?? DEFAULT_ENDPOINT;
    const payload = await fetchJson<RemotivePayload>(endpoint, this.options.fetchOptions);
    if (!payload || !Array.isArray(payload.jobs)) {
      throw new SourceError(
        "parse_error",
        "A API do Remotive devolveu uma resposta inesperada (sem lista de vagas).",
      );
    }
    this.cache = { at: Date.now(), jobs: payload.jobs };
    return payload.jobs;
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
    // Falha de rede/parse propaga como SourceError — o serviço de coleta isola por fonte.
    const jobs = await this.load();
    const categories = this.options.categories ?? DEFAULT_CATEGORIES;
    const wanted = categories.map((c) => c.trim().toLowerCase());

    let received = 0;
    let accepted = 0;
    for (const job of jobs) {
      if (ctx.signal.aborted) break;
      if (accepted >= ctx.maxJobs) break;
      received++;

      const category = (job.category ?? "").trim().toLowerCase();
      if (!wanted.includes(category)) continue;

      const raw = toRawJob(job);
      if (!raw) continue;

      accepted++;
      yield raw;
    }

    ctx.logger.log("info", "fetch", `Remotive: ${received} vagas recebidas, ${accepted} aceitas`, {
      categorias: wanted,
    });
  }
}

/** Mapeia uma vaga bruta; devolve null quando os campos mínimos faltam. */
function toRawJob(job: RemotiveJob): RawJob | null {
  if (!job || typeof job.url !== "string" || typeof job.title !== "string") return null;
  const url = job.url.trim();
  const title = job.title.trim();
  if (!url || !title) return null;

  return {
    externalId: job.id !== undefined && job.id !== null ? String(job.id) : undefined,
    sourceUrl: url,
    title,
    company: textOrUndefined(job.company_name),
    location: textOrUndefined(job.candidate_required_location),
    // A fonte é 100% remota por definição (categoria "remote jobs").
    workMode: "remote",
    contractType: mapContractType(job.job_type),
    salaryText: textOrUndefined(job.salary),
    descriptionText: typeof job.description === "string" ? htmlToText(job.description) : "",
    postedAt: toIsoUtc(job.publication_date),
    raw: job,
  };
}

function textOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * A fonte não publica nível (junior/pleno/senior): só traduz o que ela
 * realmente informa — estágio e freela. O resto fica `unknown`.
 */
function mapContractType(jobType: string | undefined): RawJob["contractType"] {
  const value = (jobType ?? "").trim().toLowerCase();
  if (value === "internship") return "internship";
  if (value === "freelance") return "freelance";
  return "unknown";
}

/**
 * `publication_date` vem sem fuso ("2026-10-29T18:22:41"): a documentação da
 * fonte não declara o fuso, então é tratado como UTC (Z) — decisão registrada
 * em docs/FONTES.md. Data ilegível → undefined (nunca é inventada).
 */
function toIsoUtc(value: string | undefined): string | undefined {
  const trimmed = textOrUndefined(value);
  if (!trimmed) return undefined;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const date = new Date(hasZone ? trimmed : `${trimmed}Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
