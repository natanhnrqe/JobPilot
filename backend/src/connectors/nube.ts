/**
 * Conector Nube (Fase 6 — verificado em 2026-11-10, ver docs/FONTES.md).
 *
 * Fatos verificados sobre a API pública:
 * - `GET /api/portal/buscar_filtro_vagas?id_tipo_vaga=1&page_size=500&offset=N`
 *   devolve `param.lista_ids_vaga`, `param.offset.total` e
 *   `param.dict_por_id_vaga[id].view` (título, cidade, UF, bolsa, selo, URL);
 * - `page_size` funciona (24/50/100/200/500); `limite` é ignorado e devolve
 *   ~3,1 MB de uma vez;
 * - a API reporta 6.062 estágios, mas só ~3.088 IDs únicos são acessíveis: a
 *   paginação além de ~3.000 repete vagas. O conector deduplica por ID e para
 *   no total reportado (ou no teto de páginas);
 * - não há filtro por cidade/estado: o recorte Curitiba/Grande Curitiba é
 *   feito no cliente; home office vem no `selo` (`home_office`);
 * - o detalhe `GET /api/portal/buscar-detalhes-vaga/json?id_vaga=...&titulo=...`
 *   traz `param._jobposting_sch` com JSON-LD `JobPosting` (título, data,
 *   validade, salário, descrição e `hiringOrganization`);
 * - a empresa contratante quase nunca é revelada: em 35 de 36 vagas o
 *   `hiringOrganization` é a própria Nube (agente). Nesse caso `company` fica
 *   indefinida — nunca gravamos a Nube como se fosse a empregadora;
 * - `robots.txt` libera `/api` (bloqueia só as áreas de gestor). A política de
 *   uso não proíbe explicitamente ler vagas públicas, mas tem cláusulas
 *   genéricas contra abuso. Por isso: cache de 15 min, uma execução por vez,
 *   User-Agent identificável e nenhum login/candidatura automática.
 *
 * Estratégia: `verify()` carrega a primeira página e `fetch()` reaproveita o
 * cache; o detalhe só é buscado para as vagas que passam no filtro local.
 */

import { htmlToText } from "../fetch/htmlText.js";
import { fetchJson, type FetchJsonOptions } from "./http.js";
import type { ConnectorContext, RawJob, SourceConnector } from "./types.js";
import { SourceError } from "./types.js";

const DEFAULT_BASE_URL = "https://www.nube.com.br";
const DEFAULT_PAGE_SIZE = 500;
/** 6.062 / 500 = 13 páginas; o teto protege contra um total inesperado. */
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
/** Pausa entre detalhes para não disparar 36 requisições em rajada. */
const DEFAULT_DETAIL_DELAY_MS = 100;

/** Cidades da Grande Curitiba aceitas como "presencial em Curitiba". */
const METRO_CURITIBA =
  /curitiba|sao jose dos pinhais|pinhais|colombo|araucaria|campo largo|fazenda rio grande|almirante tamandare/;

interface NubeView {
  id_vaga?: number | string;
  titulo?: string;
  cidade?: string;
  uf?: string;
  bolsa_valor?: string;
  selo?: unknown;
  url?: string;
  id_modalidade_atuacao?: number;
}

interface NubePageParam {
  lista_ids_vaga?: unknown;
  offset?: { total?: number; mostra_btn_mais?: number };
  dict_por_id_vaga?: Record<string, { view?: NubeView } | undefined>;
}

interface NubePayload {
  param?: NubePageParam;
}

interface NubeDetailParam {
  _jobposting_sch?: string;
  vaga_home_office?: boolean;
  vaga_hibrida?: boolean;
  texto_tipo_vaga?: string;
  texto_valor_ba?: string;
  local_horario?: { linhas?: { cidade?: { texto?: string } } };
}

interface NubeDetailPayload {
  param?: NubeDetailParam;
}

interface JobPostingLd {
  title?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } };
  baseSalary?: { currency?: string; value?: { value?: number } };
  description?: string;
}

export interface NubeOptions {
  /** Somente testes: aponta para um servidor local. */
  baseUrl?: string;
  /** Vagas por página (padrão 500; a API aceita pelo menos até 500). */
  pageSize?: number;
  /** Teto de páginas lidas por execução (padrão 20). */
  maxPages?: number;
  /** TTL do cache de listagem e de detalhe (padrão 15 min). */
  ttlMs?: number;
  /** Pausa entre requisições de detalhe (padrão 100 ms; testes usam 0). */
  detailDelayMs?: number;
  /** Relógio injetável para testar a validade das vagas. */
  now?: () => Date;
  fetchOptions?: FetchJsonOptions;
}

interface CacheEntry<T> {
  at: number;
  value: T;
}

export class NubeConnector implements SourceConnector {
  readonly key = "nube";
  readonly name = "Nube";
  readonly kind = "api" as const;
  readonly supportState = "verified" as const;
  /** A varredura completa custa ~51 s; as demais fontes seguem com 30 s. */
  readonly timeoutMs = 120_000;

  private readonly pageCache = new Map<number, CacheEntry<NubePageParam>>();
  private readonly detailCache = new Map<string, CacheEntry<NubeDetailParam | null>>();

  constructor(private readonly options: NubeOptions = {}) {}

  private get baseUrl(): string {
    return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private get pageSize(): number {
    return Math.max(1, this.options.pageSize ?? DEFAULT_PAGE_SIZE);
  }

  private get ttlMs(): number {
    return this.options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Carrega uma página da listagem (cache compartilhado entre verify e fetch). */
  private async loadPage(offset: number): Promise<NubePageParam> {
    const cached = this.pageCache.get(offset);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.value;

    const url =
      `${this.baseUrl}/api/portal/buscar_filtro_vagas?id_tipo_vaga=1` +
      `&page_size=${this.pageSize}&offset=${offset}`;
    const payload = await fetchJson<NubePayload>(url, this.options.fetchOptions);
    const page = payload?.param;
    if (!page || !Array.isArray(page.lista_ids_vaga)) {
      throw new SourceError(
        "parse_error",
        "A API da Nube devolveu uma resposta inesperada (sem lista de vagas).",
      );
    }

    this.pageCache.set(offset, { at: Date.now(), value: page });
    return page;
  }

  /** Carrega o detalhe de uma vaga; falha de detalhe é tratada pelo chamador. */
  private async loadDetail(id: string, slug: string): Promise<NubeDetailParam | null> {
    const cacheKey = `${id}:${slug}`;
    const cached = this.detailCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.value;

    const url =
      `${this.baseUrl}/api/portal/buscar-detalhes-vaga/json?id_vaga=${encodeURIComponent(id)}` +
      `&titulo=${encodeURIComponent(slug)}`;
    const payload = await fetchJson<NubeDetailPayload>(url, this.options.fetchOptions);
    const detail = payload?.param ?? null;

    this.detailCache.set(cacheKey, { at: Date.now(), value: detail });
    return detail;
  }

  async verify(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const page = await this.loadPage(0);
      const ids = page.lista_ids_vaga;
      if (!Array.isArray(ids) || ids.length === 0) {
        return { ok: false, reason: "A API respondeu sem vagas." };
      }
      if (typeof page.offset?.total !== "number") {
        return { ok: false, reason: "A API respondeu sem o total de vagas." };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async *fetch(ctx: ConnectorContext): AsyncIterable<RawJob> {
    if (ctx.signal.aborted) return;

    const first = await this.loadPage(0);
    const total = first.offset?.total ?? 0;
    if (total <= 0) {
      ctx.logger.log("warn", "fetch", "Nube: a listagem não informou o total de vagas.", {});
      return;
    }

    const maxPages = Math.min(
      this.options.maxPages ?? DEFAULT_MAX_PAGES,
      Math.max(1, Math.ceil(total / this.pageSize)),
    );
    const views = new Map<string, NubeView>();

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
      if (ctx.signal.aborted) return;

      let page: NubePageParam;
      try {
        page = pageIndex === 0 ? first : await this.loadPage(pageIndex * this.pageSize);
      } catch (err) {
        // Falha depois da primeira página: segue com o que já foi lido.
        if (pageIndex === 0) throw err;
        ctx.logger.log(
          "warn",
          "fetch",
          `Nube: falha ao ler a página ${pageIndex + 1}; seguindo com ${views.size} vagas.`,
          { erro: err instanceof Error ? err.message : String(err) },
        );
        break;
      }

      const ids = page.lista_ids_vaga;
      if (!Array.isArray(ids) || ids.length === 0) break;

      for (const rawId of ids) {
        const id = String(rawId);
        if (views.has(id)) continue;
        const view = page.dict_por_id_vaga?.[id]?.view;
        if (view?.url) views.set(id, view);
      }
    }

    const candidates = [...views.values()].filter((view) => isTarget(view));
    ctx.logger.log(
      "info",
      "fetch",
      `Nube: ${views.size} vagas lidas, ${candidates.length} no recorte Curitiba/remoto.`,
      { totalReportado: total, paginas: maxPages },
    );

    const now = this.options.now ?? (() => new Date());
    const delay = this.options.detailDelayMs ?? DEFAULT_DETAIL_DELAY_MS;
    let accepted = 0;

    for (const view of candidates) {
      if (ctx.signal.aborted) break;
      if (accepted >= ctx.maxJobs) break;

      const id = view.id_vaga !== undefined && view.id_vaga !== null ? String(view.id_vaga) : "";
      const slug = slugFromUrl(view.url);
      if (!id || !slug) continue;

      let detail: NubeDetailParam | null = null;
      try {
        detail = await this.loadDetail(id, slug);
      } catch (err) {
        ctx.logger.log(
          "warn",
          "fetch",
          `Nube: detalhe da vaga ${id} indisponível; usando os dados da listagem.`,
          { erro: err instanceof Error ? err.message : String(err) },
        );
      }

      const ld = parseJobPosting(detail);
      if (isExpired(ld?.validThrough, now())) {
        ctx.logger.log("info", "fetch", `Nube: vaga ${id} vencida — ignorada.`, {});
        continue;
      }

      const raw = toRawJob(view, detail, ld);
      if (!raw) continue;

      accepted++;
      yield raw;

      if (delay > 0) await sleep(delay);
    }

    ctx.logger.log("info", "fetch", `Nube: ${accepted} vagas aceitas.`, {});
  }
}

/** Só entram vagas de Curitiba/Grande Curitiba ou home office. */
function isTarget(view: NubeView): boolean {
  const city = normalize(view.cidade);
  const selos = seloList(view.selo);
  const remote =
    selos.includes("home office") || city === "home office" || view.id_modalidade_atuacao === 2;
  if (remote) return true;
  return METRO_CURITIBA.test(city);
}

function toRawJob(
  view: NubeView,
  detail: NubeDetailParam | null,
  ld: JobPostingLd | null,
): RawJob | null {
  const sourceUrl = absoluteUrl(view.url);
  const title = cleanTitle(ld?.title ?? view.titulo);
  if (!sourceUrl || !title) return null;

  const workMode = resolveWorkMode(view, detail);
  const location = resolveLocation(view, workMode);
  const salaryText = textOrUndefined(view.bolsa_valor) ?? textOrUndefined(detail?.texto_valor_ba);
  const description = htmlToText(ld?.description ?? "");

  return {
    externalId:
      view.id_vaga !== undefined && view.id_vaga !== null ? String(view.id_vaga) : undefined,
    sourceUrl,
    title,
    // A Nube é a agente de integração, não a empresa contratante.
    company: realCompany(ld?.hiringOrganization?.name),
    location,
    workMode,
    contractType: "internship",
    salaryText: salaryText ?? formatSalary(ld),
    descriptionText:
      description || fallbackDescription(title, location, salaryText ?? formatSalary(ld)),
    postedAt: toIsoDate(ld?.datePosted),
    raw: { view, detail, jobPosting: ld },
  };
}

function resolveWorkMode(view: NubeView, detail: NubeDetailParam | null): RawJob["workMode"] {
  const selos = seloList(view.selo);
  if (selos.includes("home office") || detail?.vaga_home_office === true) return "remote";
  if (selos.includes("hibrido") || detail?.vaga_hibrida === true) return "hybrid";
  return "onsite";
}

function resolveLocation(view: NubeView, workMode: RawJob["workMode"]): string | undefined {
  const city = textOrUndefined(view.cidade);
  const uf = textOrUndefined(view.uf);
  if (!city) return undefined;
  if (workMode === "remote" && normalize(city) === "home office") return "Home Office";
  return uf ? `${city} - ${uf}` : city;
}

/** Nome real da empresa; a Nube (agente) nunca é gravada como empregadora. */
function realCompany(name: string | undefined): string | undefined {
  const value = textOrUndefined(name);
  if (!value) return undefined;
  if (/^nube(?:\s*-|$)/i.test(normalize(value))) return undefined;
  return value;
}

function parseJobPosting(detail: NubeDetailParam | null): JobPostingLd | null {
  const html = detail?._jobposting_sch;
  if (typeof html !== "string" || html.trim() === "") return null;

  // O JSON-LD vem dentro de <script>, mas a descrição pode conter a sequência
  // "</script>" (HTML real). Por isso extraímos o objeto equilibrando chaves,
  // em vez de cortar no primeiro fechamento de tag.
  const json = extractJsonObject(html);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed.find(isJobPostingLd) as JobPostingLd | undefined) ?? null;
    }
    return isJobPostingLd(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Extrai o primeiro objeto JSON completo, respeitando strings e escapes. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function isJobPostingLd(value: unknown): value is JobPostingLd {
  return typeof value === "object" && value !== null;
}

function isExpired(validThrough: string | undefined, now: Date): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(validThrough ?? "");
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  if (year !== today.year) return year < today.year;
  if (month !== today.month) return month < today.month;
  return day < today.day;
}

function cleanTitle(value: string | undefined): string {
  const text = textOrUndefined(value);
  if (!text) return "";
  return text
    .replace(/\s*-\s*\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugFromUrl(url: string | undefined): string | null {
  const value = textOrUndefined(url);
  if (!value) return null;
  const path = value.split("?")[0] ?? "";
  const slug = path.split("/").filter(Boolean).pop();
  return slug ? slug : null;
}

function absoluteUrl(url: string | undefined): string | null {
  const value = textOrUndefined(url);
  if (!value) return null;
  try {
    return new URL(value, DEFAULT_BASE_URL).toString();
  } catch {
    return null;
  }
}

function seloList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalize(item).replace(/_/g, " "))
    .filter((item) => item !== "");
}

function formatSalary(ld: JobPostingLd | null): string | undefined {
  const value = ld?.baseSalary?.value?.value;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const currency = ld?.baseSalary?.currency;
  if (currency === "BRL") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
  return String(value);
}

/** Descrição mínima e factual quando o detalhe não está disponível. */
function fallbackDescription(
  title: string,
  location: string | undefined,
  salary: string | undefined,
): string {
  const parts = [`Vaga de estágio em ${title}`];
  if (location) parts.push(`em ${location}`);
  if (salary) parts.push(`Bolsa: ${salary}`);
  return `${parts.join(" ")}.`;
}

/** `datePosted` vem como YYYY-MM-DD; data ilegível → undefined (nunca inventada). */
function toIsoDate(value: string | undefined): string | undefined {
  const text = textOrUndefined(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
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
    .toLowerCase()
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
