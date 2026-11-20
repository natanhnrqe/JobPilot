/**
 * Conector Himalayas — Fase 6.9 (verificado em 2026-11-19, ver docs/FONTES.md).
 *
 * Fatos verificados sobre a API pública (sem chave):
 * - `GET https://himalayas.app/jobs/api/search?employment_type=Intern&country=BR&page=N`
 *   devolve `{ totalCount, limit, offset, jobs: [...] }`; a página tem 20 vagas;
 * - a busca por `Intern` + `country=BR` retornou **50 estágios** em 2026-11-19,
 *   incluindo vagas de tecnologia (AI Engineering, Full Stack, BI);
 * - cada vaga traz `guid`, `title`, `companyName`, `employmentType`,
 *   `locationRestrictions`, `description` (HTML), `applicationLink`,
 *   `pubDate`/`expiryDate` (Unix em segundos), `minSalary`/`maxSalary`/`currency`
 *   e `salaryPeriod`;
 * - `locationRestrictions` vazio significa vaga mundial; a consulta por país já
 *   inclui as vagas mundiais elegíveis para o Brasil;
 * - `robots.txt` libera `/jobs` e a API é a mesma usada pela busca do site.
 *
 * Condições de uso: manter o `applicationLink` intacto, dar atribuição visível
 * ao Himalayas e não repassar as vagas a outros quadros/agregadores. O JobPilot
 * é local: mostra a vaga, o link e a fonte; não republica nem envia candidatura.
 *
 * A fonte é 100% remota por definição; `workMode` é sempre `remote`.
 */

import { htmlToText } from "../fetch/htmlText.js";
import { fetchJson, type FetchJsonOptions } from "./http.js";
import type { ConnectorContext, RawJob, SourceConnector } from "./types.js";
import { SourceError } from "./types.js";

const DEFAULT_BASE_URL = "https://himalayas.app";
const DEFAULT_COUNTRY = "BR";
const DEFAULT_EMPLOYMENT_TYPE = "Intern";
/** A API entrega 20 por página; o teto protege contra um total inesperado. */
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_PAGE_SIZE = 20;

interface HimalayasJob {
  guid?: string;
  title?: string;
  companyName?: string;
  employmentType?: string;
  locationRestrictions?: string[];
  description?: string;
  excerpt?: string;
  applicationLink?: string;
  pubDate?: number;
  expiryDate?: number;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  salaryPeriod?: string | null;
}

interface HimalayasPayload {
  totalCount?: number;
  limit?: number;
  offset?: number;
  jobs?: unknown;
}

export interface HimalayasOptions {
  /** Somente testes: aponta para um servidor local. */
  baseUrl?: string;
  /** País ISO alpha-2 (padrão `BR`). */
  country?: string;
  /** Tipo de contrato buscado (padrão `Intern`). */
  employmentType?: string;
  /** Teto de páginas por execução (padrão 5 = 100 vagas). */
  maxPages?: number;
  /** Relógio injetável para os testes de expiração. */
  now?: () => Date;
  fetchOptions?: FetchJsonOptions;
}

export class HimalayasConnector implements SourceConnector {
  readonly key = "himalayas";
  readonly name = "Himalayas (remoto)";
  readonly kind = "api" as const;
  readonly supportState = "verified" as const;
  /** Até 5 páginas de 20 vagas cabem com folga no teto. */
  readonly timeoutMs = 45_000;

  constructor(private readonly options: HimalayasOptions = {}) {}

  private get baseUrl(): string {
    return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private get maxPages(): number {
    return Math.max(1, Math.trunc(this.options.maxPages ?? DEFAULT_MAX_PAGES));
  }

  private async loadPage(
    page: number,
  ): Promise<{ jobs: HimalayasJob[]; total: number; offset: number; limit: number }> {
    const url = new URL(`${this.baseUrl}/jobs/api/search`);
    url.searchParams.set(
      "employment_type",
      this.options.employmentType?.trim() || DEFAULT_EMPLOYMENT_TYPE,
    );
    url.searchParams.set("country", this.options.country?.trim() || DEFAULT_COUNTRY);
    url.searchParams.set("page", String(page));

    const payload = await fetchJson<HimalayasPayload>(url.toString(), this.options.fetchOptions);

    if (!payload || typeof payload !== "object" || !Array.isArray(payload.jobs)) {
      throw new SourceError(
        "parse_error",
        "A Himalayas devolveu uma resposta inesperada (sem lista de vagas).",
      );
    }

    return {
      jobs: payload.jobs as HimalayasJob[],
      total: typeof payload.totalCount === "number" ? payload.totalCount : 0,
      offset: typeof payload.offset === "number" ? payload.offset : (page - 1) * DEFAULT_PAGE_SIZE,
      limit: typeof payload.limit === "number" ? payload.limit : DEFAULT_PAGE_SIZE,
    };
  }

  async verify(): Promise<{ ok: boolean; reason?: string }> {
    try {
      // Lista vazia é resposta válida; o que importa é o formato.
      await this.loadPage(1);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async *fetch(ctx: ConnectorContext): AsyncIterable<RawJob> {
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    const nowSeconds = Math.floor((this.options.now?.() ?? new Date()).getTime() / 1000);
    let received = 0;
    let accepted = 0;
    let pages = 0;

    for (let page = 1; page <= this.maxPages; page++) {
      if (ctx.signal.aborted) return;
      if (accepted >= ctx.maxJobs) break;

      const { jobs, total, offset, limit } = await this.loadPage(page);
      pages++;
      received += jobs.length;

      for (const job of jobs) {
        if (ctx.signal.aborted) break;
        if (accepted >= ctx.maxJobs) break;

        // Só estágio; a consulta já filtra, mas a resposta é a fonte da verdade.
        if (job.employmentType && !isInternshipText(job.employmentType)) continue;
        // Vaga expirada não entra (a data é da fonte, em segundos).
        if (isExpired(job.expiryDate, nowSeconds)) continue;

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
      if (jobs.length === 0 || offset + jobs.length >= total || jobs.length < limit) break;
    }

    ctx.logger.log("info", "fetch", `Himalayas: ${received} vagas recebidas, ${accepted} aceitas`, {
      paginas: pages,
      pais: this.options.country?.trim() || DEFAULT_COUNTRY,
    });
  }
}

function toRawJob(job: HimalayasJob): RawJob | null {
  const sourceUrl = text(job.applicationLink);
  const title = text(job.title);
  if (!sourceUrl || !title) return null;

  return {
    externalId: text(job.guid),
    sourceUrl,
    title,
    company: text(job.companyName),
    location: resolveLocation(job.locationRestrictions),
    workMode: "remote",
    contractType: "internship",
    salaryText: formatSalary(job),
    descriptionText: htmlToText(job.description ?? job.excerpt ?? ""),
    postedAt: toIsoDate(job.pubDate),
    raw: job,
  };
}

/** "Brazil"; vazio = vaga mundial (a fonte não informa país). */
function resolveLocation(restrictions: string[] | undefined): string {
  const values = (restrictions ?? []).map((value) => value.trim()).filter((value) => value !== "");
  return values.length > 0 ? values.join(", ") : "Remoto";
}

function formatSalary(job: HimalayasJob): string | undefined {
  const min = typeof job.minSalary === "number" && job.minSalary > 0 ? job.minSalary : undefined;
  const max = typeof job.maxSalary === "number" && job.maxSalary > 0 ? job.maxSalary : undefined;
  if (min === undefined && max === undefined) return undefined;

  const currency = text(job.currency) ?? "";
  const period = salaryPeriod(job.salaryPeriod);
  const amount =
    min !== undefined && max !== undefined && min !== max
      ? `${formatNumber(min)}–${formatNumber(max)}`
      : formatNumber(min ?? max!);
  const prefix = currency ? `${currency} ` : "";
  return `${prefix}${amount}${period}`;
}

function salaryPeriod(value: string | null | undefined): string {
  const period = normalize(value ?? "");
  if (period === "monthly" || period === "month") return "/mês";
  if (period === "annual" || period === "yearly" || period === "year") return "/ano";
  if (period === "weekly" || period === "week") return "/semana";
  if (period === "fortnightly") return "/quinzena";
  if (period === "hourly" || period === "hour") return "/hora";
  return "";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

/** Unix em segundos; inválido/ausente fica indefinido (nunca a data atual). */
function toIsoDate(value: number | null | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function isExpired(expiryDate: number | undefined, nowSeconds: number): boolean {
  return (
    typeof expiryDate === "number" &&
    Number.isFinite(expiryDate) &&
    expiryDate > 0 &&
    expiryDate < nowSeconds
  );
}

function isInternshipText(value: string): boolean {
  return /intern|estagi|trainee/.test(normalize(value));
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
