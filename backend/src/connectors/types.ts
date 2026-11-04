/**
 * Contrato de conector de fonte (Seção 6.1 da especificação).
 *
 * Regras: o conector apenas DEVOLVE vagas brutas (`RawJob`). Validação,
 * normalização de persistência, deduplicação e gravação são responsabilidade
 * do serviço de coleta (`services/collect.ts`) — nunca do conector.
 */

export interface RawJob {
  /** Identificador estável na fonte, quando existir. */
  externalId?: string;
  /** URL canônica da vaga (obrigatória). */
  sourceUrl: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: "remote" | "hybrid" | "onsite" | "unknown";
  contractType?: "internship" | "junior" | "mid" | "senior" | "freelance" | "unknown";
  salaryText?: string;
  /** Texto puro (sem HTML), pronto para dedupe e para a IA. */
  descriptionText: string;
  /** ISO quando a fonte informar a data; nunca é preenchido com "agora". */
  postedAt?: string;
  /** Payload cru recebido da fonte (auditoria). */
  raw: unknown;
}

export type SupportState = "unverified" | "verified" | "broken" | "blocked";

export type ConnectorLogLevel = "debug" | "info" | "warn" | "error";

export interface ConnectorLogger {
  log(
    level: ConnectorLogLevel,
    step: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void;
}

export interface ConnectorContext {
  runId: number;
  signal: AbortSignal;
  logger: ConnectorLogger;
  /** Máximo de vagas aceitas por fonte em uma execução (Seção 6.4). */
  maxJobs: number;
}

export interface SourceConnector {
  readonly key: string;
  readonly name: string;
  readonly kind: "api" | "html" | "browser";
  /** Estado declarado após verificação documentada em `docs/FONTES.md`. */
  readonly supportState: SupportState;
  /** Declara viabilidade; lança `SourceError("unsupported")` quando não viável. */
  verify(): Promise<{ ok: boolean; reason?: string }>;
  fetch(ctx: ConnectorContext): AsyncIterable<RawJob>;
}

export class SourceError extends Error {
  constructor(
    public readonly code:
      "unsupported" | "rate_limited" | "blocked" | "parse_error" | "network" | "captcha_required",
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}
