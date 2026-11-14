/**
 * Execução de coleta de vagas (Seção 7.2 da especificação).
 *
 * Ordem: lock global → `search_runs` → por fonte (`verify()` + `fetch()`, no
 * máximo 2 em paralelo) → normalização + dedupe → gravação pelos **mesmos
 * serviços do cadastro manual** (`createJob`, com evento `job.created`) →
 * `execution_logs` → fechar a execução com contadores → `data/last-run.json`
 * → liberar o lock.
 *
 * Deduplicação da coleta (Seção 6.2, adaptada à migração 003):
 * 1. `source + external_id` (forte, coberto pelo índice único parcial);
 * 2. URL normalizada (forte);
 * 3. empresa + título + localização normalizados (indício forte).
 * A vaga existente **nunca** é alterada: status, candidaturas e notas do
 * usuário ficam intactos. Por isso `updated_count` permanece 0 nesta etapa.
 *
 * Falha de uma fonte nunca aborta as demais (Seção 6.4): o resultado fica
 * `partial` e as vagas já gravadas são preservadas.
 */

import fs from "node:fs";
import path from "node:path";
import type { ServiceContext } from "./context.js";
import type {
  ConnectorContext,
  ConnectorLogger,
  RawJob,
  SourceConnector,
} from "../connectors/types.js";
import { SourceError } from "../connectors/types.js";
import { findJobByExternalId, getJobRow } from "../repositories/jobs.js";
import {
  findSourceByKey,
  finishSearchRun,
  insertExecutionLog,
  insertSearchRun,
  upsertSource,
} from "../repositories/sources.js";
import { findPossibleDuplicates, normalizeText, normalizeUrl } from "../domain/dedupe.js";
import {
  inferContractTypeFromTitle,
  type ContractTypeSource,
  type ContractTypeValue,
} from "../domain/contractType.js";
import { normalizePostedAt } from "../ai/schemas.js";
import { getSearchPreferences, type SearchPreferences } from "../repositories/preferences.js";
import { matchesArea } from "../domain/areaFilter.js";
import { createJob } from "./jobs.js";
import { acquireLock } from "./lock.js";

export type CollectTrigger = "manual" | "scheduled";
export type CollectStatus = "success" | "partial" | "failed" | "skipped";
export type SourceStatus = "ok" | "error" | "skipped";

/** Limite padrão de vagas aceitas por fonte em uma execução (Seção 6.4). */
export const DEFAULT_MAX_JOBS_PER_RUN = 200;
/** Timeout padrão por fonte (Seção 6.4). */
export const DEFAULT_SOURCE_TIMEOUT_MS = 30_000;
/** Paralelismo máximo entre fontes (Seção 7.2). */
export const DEFAULT_PARALLELISM = 2;

export interface CollectOptions {
  /** Fontes a executar (injetadas pelo CLI; testes usam conectores falsos). */
  connectors: SourceConnector[];
  trigger: CollectTrigger;
  maxJobsPerRun?: number;
  /** Timeout padrão por fonte; `SourceConnector.timeoutMs` tem precedência. */
  sourceTimeoutMs?: number;
  parallelism?: number;
  /** Caminho do lock; padrão `data/.lock`. */
  lockPath?: string;
  /** Grava `data/last-run.json` (padrão true). */
  writeLastRun?: boolean;
  /** Relógio injetável (testes). */
  now?: () => Date;
}

export interface SourceReport {
  key: string;
  name: string;
  status: SourceStatus;
  discovered: number;
  created: number;
  duplicate: number;
  /** Ignoradas pelas preferências de busca (tipo de contrato). */
  filtered: number;
  error: string | null;
}

export interface CollectResult {
  runId: number;
  status: CollectStatus;
  trigger: CollectTrigger;
  startedAt: string;
  finishedAt: string;
  discovered: number;
  created: number;
  updated: number;
  duplicate: number;
  /** Ignoradas pelas preferências de busca (tipo de contrato). */
  filtered: number;
  errors: number;
  summary: string;
  sources: SourceReport[];
  /** Código de saída do CLI: success/partial/skipped → 0; failed → 1. */
  exitCode: 0 | 1;
}

/** Código de saída do CLI (Seção 7.2). */
export function collectExitCode(status: CollectStatus): 0 | 1 {
  return status === "failed" ? 1 : 0;
}

/**
 * Executa uma coleta completa. Devolve o resultado consolidado; o CLI usa
 * `exitCode` e o dashboard pode ler `data/last-run.json`.
 */
export async function runCollect(
  ctx: ServiceContext,
  opts: CollectOptions,
): Promise<CollectResult> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const lockPath = opts.lockPath ?? path.join(ctx.config.dataDir, ".lock");

  const lock = acquireLock(lockPath, now().getTime());
  if (!lock) {
    // Outra execução em andamento: registra como `skipped` e sai com código 0.
    return recordSkippedRun(ctx, opts, startedAt, now);
  }

  try {
    return await executeCollect(ctx, opts, startedAt, now);
  } finally {
    lock.release();
  }
}

async function executeCollect(
  ctx: ServiceContext,
  opts: CollectOptions,
  startedAt: string,
  now: () => Date,
): Promise<CollectResult> {
  const db = ctx.holder.get();
  const runId = insertSearchRun(db, { trigger: opts.trigger, startedAt });
  // Preferências lidas uma vez por execução: mudanças no meio da coleta não
  // produzem resultado inconsistente entre fontes.
  const preferences = getSearchPreferences(db);

  const maxJobs = opts.maxJobsPerRun ?? DEFAULT_MAX_JOBS_PER_RUN;
  const timeoutMs = opts.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const parallelism = Math.max(1, opts.parallelism ?? DEFAULT_PARALLELISM);
  // Fontes com paginação pesada (ex.: Nube) declaram seu próprio timeout; as
  // demais continuam com o padrão de 30 s.

  // Fontes registradas/atualizadas antes de qualquer busca (o mesmo upsert da
  // migração 003). `enabled` é preservado — o usuário pode desabilitar uma fonte.
  const prepared = opts.connectors.map((connector) => ({
    connector,
    sourceId: upsertSource(db, {
      key: connector.key,
      name: connector.name,
      kind: connector.kind,
      supportState: connector.supportState,
    }),
  }));

  // Busca em paralelo limitado; a persistência é sequencial para que o dedupe
  // veja as vagas gravadas pelas fontes anteriores (sem corrida de leitura).
  const fetched = await mapWithLimit(prepared, parallelism, (item) =>
    fetchSource(ctx, item, runId, maxJobs, timeoutMs),
  );

  const sources: SourceReport[] = [];
  let discovered = 0;
  let created = 0;
  let duplicate = 0;
  let filtered = 0;

  for (const item of fetched) {
    const counts =
      item.status === "ok"
        ? persistSource(ctx, item.sourceId, item.connector.key, item.jobs, runId, preferences)
        : { created: 0, duplicate: 0, filtered: 0 };

    sources.push({
      key: item.connector.key,
      name: item.connector.name,
      status: item.status,
      discovered: item.jobs.length,
      created: counts.created,
      duplicate: counts.duplicate,
      filtered: counts.filtered,
      error: item.error,
    });

    discovered += item.jobs.length;
    created += counts.created;
    duplicate += counts.duplicate;
    filtered += counts.filtered;
  }

  const failed = sources.filter((s) => s.status === "error");
  const status: CollectStatus =
    sources.length === 0
      ? "failed"
      : failed.length === 0
        ? "success"
        : failed.length === sources.length
          ? "failed"
          : "partial";
  const errors = sources.length === 0 ? 1 : failed.length;
  const summary = buildSummary(sources, { discovered, created, duplicate, filtered });
  const finishedAt = now().toISOString();

  finishSearchRun(db, runId, {
    status,
    finishedAt,
    discovered,
    created,
    updated: 0,
    duplicate,
    errors,
    summary,
  });

  const result: CollectResult = {
    runId,
    status,
    trigger: opts.trigger,
    startedAt,
    finishedAt,
    discovered,
    created,
    updated: 0,
    duplicate,
    filtered,
    errors,
    summary,
    sources,
    exitCode: collectExitCode(status),
  };

  if (opts.writeLastRun !== false) writeLastRunFile(ctx, result);
  return result;
}

function recordSkippedRun(
  ctx: ServiceContext,
  opts: CollectOptions,
  startedAt: string,
  now: () => Date,
): CollectResult {
  const db = ctx.holder.get();
  const runId = insertSearchRun(db, { trigger: opts.trigger, startedAt });

  insertExecutionLog(db, {
    runId,
    jobType: "collect",
    level: "warn",
    step: "lock",
    message: "Outra execução de coleta está em andamento (lock ativo) — execução pulada.",
  });

  const finishedAt = now().toISOString();
  const summary = "concurrent";
  finishSearchRun(db, runId, {
    status: "skipped",
    finishedAt,
    discovered: 0,
    created: 0,
    updated: 0,
    duplicate: 0,
    errors: 0,
    summary,
  });

  const result: CollectResult = {
    runId,
    status: "skipped",
    trigger: opts.trigger,
    startedAt,
    finishedAt,
    discovered: 0,
    created: 0,
    updated: 0,
    duplicate: 0,
    filtered: 0,
    errors: 0,
    summary,
    sources: [],
    exitCode: 0,
  };

  if (opts.writeLastRun !== false) writeLastRunFile(ctx, result);
  return result;
}

interface FetchedSource {
  connector: SourceConnector;
  sourceId: number;
  status: SourceStatus;
  jobs: RawJob[];
  error: string | null;
}

async function fetchSource(
  ctx: ServiceContext,
  item: { connector: SourceConnector; sourceId: number },
  runId: number,
  maxJobs: number,
  timeoutMs: number,
): Promise<FetchedSource> {
  const db = ctx.holder.get();
  const { connector, sourceId } = item;
  const jobs: RawJob[] = [];

  const sourceRow = findSourceByKey(db, connector.key);
  if (sourceRow && sourceRow.enabled === 0) {
    insertExecutionLog(db, {
      runId,
      jobType: "collect",
      level: "info",
      step: "fetch",
      message: `Fonte ${connector.key} desabilitada — ignorada nesta execução.`,
      meta: { fonte: connector.key },
    });
    return { connector, sourceId, status: "skipped", jobs, error: null };
  }

  const effectiveTimeoutMs = connector.timeoutMs ?? timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  const logger: ConnectorLogger = {
    log(level, step, message, meta) {
      insertExecutionLog(db, {
        runId,
        jobType: "collect",
        level,
        step,
        message,
        meta: meta ?? null,
      });
    },
  };

  insertExecutionLog(db, {
    runId,
    jobType: "collect",
    level: "info",
    step: "fetch",
    message: `Buscando fonte ${connector.key}.`,
    meta: { fonte: connector.key },
  });

  try {
    const verification = await connector.verify();
    if (!verification.ok) {
      throw new SourceError(
        "network",
        verification.reason ?? "A verificação da fonte não foi concluída.",
      );
    }

    const connectorCtx: ConnectorContext = {
      runId,
      signal: controller.signal,
      logger,
      maxJobs,
    };

    for await (const raw of connector.fetch(connectorCtx)) {
      if (jobs.length >= maxJobs) break;
      jobs.push(raw);
    }

    if (controller.signal.aborted) {
      throw new SourceError("network", `Tempo limite de ${effectiveTimeoutMs} ms excedido.`);
    }

    insertExecutionLog(db, {
      runId,
      jobType: "collect",
      level: "info",
      step: "fetch",
      message: `Fonte ${connector.key}: ${jobs.length} vagas recebidas.`,
      meta: { fonte: connector.key },
    });

    return { connector, sourceId, status: "ok", jobs, error: null };
  } catch (err) {
    const message =
      err instanceof SourceError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);

    insertExecutionLog(db, {
      runId,
      jobType: "collect",
      level: "error",
      step: "fetch",
      message: `Fonte ${connector.key} falhou: ${message}`,
      meta: { fonte: connector.key },
    });

    return { connector, sourceId, status: "error", jobs, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Persiste as vagas de uma fonte, uma a uma (transação atômica por vaga). */
function persistSource(
  ctx: ServiceContext,
  sourceId: number,
  sourceKey: string,
  jobs: RawJob[],
  runId: number,
  preferences: SearchPreferences,
): { created: number; duplicate: number; filtered: number } {
  let created = 0;
  let duplicate = 0;
  let filtered = 0;
  let invalid = 0;

  for (const raw of jobs) {
    const outcome = persistRawJob(ctx, sourceId, raw, runId, preferences);
    if (outcome === "created") created++;
    else if (outcome === "duplicate") duplicate++;
    else if (outcome === "filtered") filtered++;
    else invalid++;
  }

  insertExecutionLog(ctx.holder.get(), {
    runId,
    jobType: "collect",
    level: "info",
    step: "persist",
    message:
      `Fonte ${sourceKey}: ${created} novas, ${duplicate} duplicadas, ` +
      `${filtered} filtradas pelas preferências, ${invalid} ignoradas.`,
    meta: { fonte: sourceKey, filtradas: filtered },
  });

  return { created, duplicate, filtered };
}

type PersistOutcome = "created" | "duplicate" | "filtered" | "invalid";

/**
 * Valida/normaliza uma vaga bruta e grava pelo serviço existente.
 * Nunca inventa dados: campos ausentes ficam nulos e `postedAt` inválido vira
 * `null` (jamais a data atual).
 */
function persistRawJob(
  ctx: ServiceContext,
  sourceId: number,
  raw: RawJob,
  runId: number,
  preferences: SearchPreferences,
): PersistOutcome {
  const db = ctx.holder.get();

  const title = text(raw.title, 300);
  const sourceUrl = (raw.sourceUrl ?? "").trim();
  if (!title || normalizeUrl(sourceUrl) === null) {
    insertExecutionLog(db, {
      runId,
      jobType: "collect",
      level: "warn",
      step: "persist",
      message: "Vaga ignorada: título ausente ou URL fora de http(s).",
      meta: { fonte: sourceId },
    });
    return "invalid";
  }

  // Filtro de preferências antes de qualquer gravação: a vaga que não interessa
  // nem entra no banco (e não altera o histórico de vagas já conhecidas).
  const contract = resolveContractType(raw);
  if (!matchesContractPreference(contract.type, preferences)) {
    return "filtered";
  }

  // Filtro por área: só grava se o título/descrição contiver alguma palavra-chave.
  // Lista vazia mantém o comportamento anterior (sem filtro por área).
  if (!matchesArea(raw.title, raw.descriptionText, preferences.areaKeywords)) {
    return "filtered";
  }

  const externalId = text(raw.externalId, 200);
  const company = text(raw.company, 200);
  const location = text(raw.location, 200);

  // 1) Identificador externo da mesma fonte (forte).
  if (externalId) {
    const existing = findJobByExternalId(db, sourceId, externalId);
    if (existing) return "duplicate";
  }

  // 2) URL normalizada (forte) e 3) empresa+título (indício).
  const candidates = findPossibleDuplicates(db, { sourceUrl, title, company });
  if (candidates.some((c) => c.reason === "url")) return "duplicate";

  const titleCandidate = candidates.find((c) => c.reason === "empresa+titulo");
  if (titleCandidate) {
    const existing = getJobRow(db, titleCandidate.id);
    if (existing && locationsCompatible(location, existing.location)) return "duplicate";
  }

  createJob(ctx, {
    title,
    company,
    location,
    workMode: pickWorkMode(raw.workMode),
    contractType: contract.type,
    contractTypeSource: contract.source,
    salaryText: text(raw.salaryText, 200),
    descriptionText: text(raw.descriptionText, 20_000),
    sourceUrl,
    postedAt: normalizePostedAt(raw.postedAt),
    sourceId,
    externalId,
  });

  return "created";
}

/** Sem localização de um dos lados, a Seção 6.2 usa o fallback empresa+título. */
function locationsCompatible(rawLocation: string | null, existing: string | null): boolean {
  const a = normalizeText(rawLocation ?? "");
  const b = normalizeText(existing ?? "");
  if (!a || !b) return true;
  return a === b;
}

const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"] as const;
const CONTRACT_TYPES = ["internship", "junior", "mid", "senior", "freelance", "unknown"] as const;

function pickWorkMode(value: string | undefined): (typeof WORK_MODES)[number] {
  return (WORK_MODES as readonly string[]).includes(value ?? "")
    ? (value as (typeof WORK_MODES)[number])
    : "unknown";
}

function pickContractType(value: string | undefined): ContractTypeValue {
  return (CONTRACT_TYPES as readonly string[]).includes(value ?? "")
    ? (value as ContractTypeValue)
    : "unknown";
}

/**
 * Precedência do tipo de contrato: o que a fonte informou > classificação
 * conservadora pelo título > `unknown`. A origem acompanha o valor para que a
 * UI mostre quando o nível foi inferido (nunca é apresentado como dado da fonte).
 */
function resolveContractType(raw: RawJob): {
  type: ContractTypeValue;
  source: ContractTypeSource;
} {
  const reported = pickContractType(raw.contractType);
  if (reported !== "unknown") return { type: reported, source: "source" };

  const inferred = inferContractTypeFromTitle(raw.title);
  if (inferred) return { type: inferred, source: "title" };

  return { type: "unknown", source: "unknown" };
}

/** Lista vazia = sem filtro por tipo; `unknown` só entra se o usuário permitir. */
function matchesContractPreference(
  type: ContractTypeValue,
  preferences: SearchPreferences,
): boolean {
  if (preferences.contractTypes.length === 0) return true;
  if (type === "unknown") return preferences.includeUnknownContractType;
  return preferences.contractTypes.includes(type);
}

function text(value: string | undefined | null, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

function buildSummary(
  sources: SourceReport[],
  counts: { discovered: number; created: number; duplicate: number; filtered: number },
): string {
  if (sources.length === 0) return "Nenhuma fonte configurada.";

  const failed = sources.filter((s) => s.status === "error");
  const skipped = sources.filter((s) => s.status === "skipped");
  const ok = sources.filter((s) => s.status === "ok");

  const parts = [
    `${ok.length}/${sources.length} fontes ok`,
    `${counts.discovered} lidas`,
    `${counts.created} novas`,
    `${counts.duplicate} duplicadas`,
  ];
  if (counts.filtered > 0) parts.push(`${counts.filtered} filtradas`);
  if (skipped.length > 0) parts.push(`${skipped.length} desabilitadas`);
  if (failed.length > 0) {
    parts.push(`falhas: ${failed.map((s) => `${s.key} (${s.error ?? "erro"})`).join("; ")}`);
  }
  return parts.join(" · ");
}

/** Resumo da última execução para o dashboard (Seção 7.4). */
function writeLastRunFile(ctx: ServiceContext, result: CollectResult): void {
  try {
    fs.mkdirSync(ctx.config.dataDir, { recursive: true });
    const file = path.join(ctx.config.dataDir, "last-run.json");
    fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } catch {
    // Falha ao gravar o resumo nunca derruba a coleta: a execução já está no banco.
  }
}

/** Executa `fn` para todos os itens com concorrência limitada, preservando a ordem. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
