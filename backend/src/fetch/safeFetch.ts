/**
 * Obtenção limitada e segura de conteúdo por URL (Seção 3 da instrução da Fase 2).
 *
 * Proteções implementadas:
 * - apenas http/https;
 * - resolução de DNS validada ANTES da requisição: bloqueia loopback, IPs
 *   privados, link-local, CGNAT, multicast e endereços não roteáveis;
 * - redirecionamentos seguidos manualmente, revalidando cada salto (inclui
 *   cada novo host resolvido);
 * - timeout, tamanho máximo de resposta e tipos de conteúdo restritos;
 * - sem execução de JavaScript e sem tentativa de contornar proteções
 *   (CAPTCHA/paywall → erro com orientação para colar o texto).
 *
 * Limitação documentada: a conexão final usa a resolução de DNS do sistema
 * (não fixamos o IP verificado na conexão TLS). O risco de DNS rebinding
 * residual é aceito nesta escala e registrado em docs/ESPECIFICACAO-TECNICA.md.
 */

import { AppError } from "../domain/errors.js";
import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const DEFAULT_ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export interface FetchedPage {
  content: string;
  finalUrl: string;
  contentType: string;
  bytes: number;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * Apenas para testes automatizados: permite loopback (127.0.0.1 / ::1) para
   * servidores locais de teste. IPs privados, link-local e endereços de
   * metadata continuam BLOQUEADOS mesmo com esta opção. NUNCA usar em produção.
   */
  allowLoopbackForTests?: boolean;
  /** Tipos de conteúdo aceitos na resposta final (padrão: HTML/texto). */
  allowedContentTypes?: string[];
  /** User-Agent enviado (padrão identificável; veja Seção 6.4 da especificação). */
  userAgent?: string;
}

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true; // esta rede, privada, loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // privada
    if (a === 192 && b === 168) return true; // privada
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reservado
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true; // não especificado, loopback
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    if (lower.startsWith("ff")) return true; // multicast
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapeado — valida a parte IPv4
      return isPrivateIp(lower.replace("::ffff:", ""));
    }
    return false;
  }
  return true; // não é IP válido → bloqueia
}

async function assertPublicHost(hostname: string, options: SafeFetchOptions): Promise<void> {
  if (net.isIP(hostname)) {
    if (ipIsBlocked(hostname, options)) {
      throw blocked(hostname);
    }
    return;
  }
  let addresses: string[];
  try {
    addresses = await dns
      .lookup(hostname, { all: true, verbatim: true })
      .then((r) => r.map((x) => x.address));
  } catch {
    throw new AppError("FETCH_ERROR", 502, `Não foi possível resolver o endereço "${hostname}".`);
  }
  if (addresses.length === 0) {
    throw new AppError("FETCH_ERROR", 502, `Endereço "${hostname}" sem IP válido.`);
  }
  if (addresses.some((ip) => ipIsBlocked(ip, options))) {
    throw blocked(hostname);
  }
}

/** Loopback IPv4/IPv6 (aceito apenas com allowLoopbackForTests). */
function isLoopback(ip: string): boolean {
  if (net.isIPv4(ip)) return ip.startsWith("127.");
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("::ffff:127.");
}

/**
 * Regra central de SSRF: bloqueia qualquer endereço não público, exceto
 * loopback quando (e somente quando) a opção de teste está ativa.
 * Exportada para os testes cobrirem a matriz de endereços.
 */
export function ipIsBlocked(ip: string, options: SafeFetchOptions = {}): boolean {
  if (!isPrivateIp(ip)) return false;
  if (options.allowLoopbackForTests && isLoopback(ip)) return false;
  return true;
}

function blocked(target: string): AppError {
  return new AppError(
    "FETCH_ERROR",
    400,
    `Destino não permitido por segurança (endereço interno/privado): "${target}". Acesse a vaga no navegador e cole o texto aqui.`,
  );
}

/**
 * Faz a requisição com validação de cada salto de redirecionamento.
 * Base comum para páginas de vaga (HTML) e para APIs das fontes (JSON).
 */
export async function fetchPublicResource(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const allowedContentTypes = options.allowedContentTypes ?? DEFAULT_ALLOWED_CONTENT_TYPES;
  const userAgent = options.userAgent ?? "JobPilot/0.1 (local; contato: usuario-local)";

  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl.trim());
  } catch {
    throw new AppError("FETCH_ERROR", 400, "URL inválida.");
  }

  if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
    throw new AppError("FETCH_ERROR", 400, "Apenas URLs http:// ou https:// são aceitas.");
  }

  let bytes = 0;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(currentUrl.hostname, options);

    const response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": userAgent,
        Accept: `${allowedContentTypes.join(", ")}, */*;q=0.5`,
      },
    }).catch((err: unknown) => {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      throw new AppError(
        "FETCH_ERROR",
        502,
        isTimeout
          ? `A página não respondeu em ${timeoutMs} ms.`
          : `Falha ao acessar a URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // Redirecionamento: revalida o próximo destino (host pode mudar).
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new AppError("FETCH_ERROR", 502, "Redirecionamento sem destino (Location vazio).");
      }
      response.body?.cancel().catch(() => {});
      try {
        currentUrl = new URL(location, currentUrl);
      } catch {
        throw new AppError("FETCH_ERROR", 502, "Redirecionamento para URL inválida.");
      }
      if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
        throw new AppError("FETCH_ERROR", 400, "Redirecionamento para protocolo não permitido.");
      }
      continue;
    }

    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new AppError(
        "FETCH_ERROR",
        422,
        `Acesso automático bloqueado pelo destino (HTTP ${response.status}). Se for uma vaga, abra no navegador e cole a descrição manualmente.`,
      );
    }
    if (!response.ok) {
      throw new AppError("FETCH_ERROR", 502, `O destino respondeu HTTP ${response.status}.`);
    }

    const contentType =
      (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!allowedContentTypes.includes(contentType)) {
      throw new AppError(
        "FETCH_ERROR",
        415,
        `Tipo de conteúdo não suportado (${contentType || "desconhecido"}). Cole a descrição manualmente.`,
      );
    }

    const buffer = await response.arrayBuffer().catch(() => {
      throw new AppError("FETCH_ERROR", 502, "Falha ao ler o conteúdo da página.");
    });
    bytes = buffer.byteLength;
    if (bytes > maxBytes) {
      throw new AppError("FETCH_ERROR", 413, `Página maior que o limite de ${maxBytes} bytes.`);
    }

    return {
      content: new TextDecoder("utf-8").decode(buffer),
      finalUrl: currentUrl.toString(),
      contentType,
      bytes,
    };
  }

  throw new AppError("FETCH_ERROR", 508, `Mais de ${MAX_REDIRECTS} redirecionamentos.`);
}

/** Obtenção de página de vaga (HTML/texto). Mantém o nome usado pelos serviços. */
export function fetchJobPage(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchedPage> {
  return fetchPublicResource(rawUrl, options);
}
