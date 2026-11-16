/**
 * Blocklist de domínios que não são fontes confiáveis de vaga.
 *
 * Alguns agregadores de baixa qualidade republicam vagas com a empresa
 * mascarada (ex.: "reputed company") e sem data/local. Gravar essas vagas
 * polui o banco e faz a pessoa perder tempo. A lista é conservadora: só entra
 * domínio com evidência de conteúdo falso ou de spam, e o bloqueio é feito
 * antes de qualquer gravação (a vaga conta como "filtrada" no resumo).
 *
 * Para adicionar um domínio, registre a evidência em `docs/FONTES.md` e cubra
 * o caso em `backend/tests/unit/sourceDomains.test.ts`.
 */

/** Sufixos bloqueados; o subdomínio também é bloqueado. */
export const BLOCKED_SOURCE_DOMAINS = ["dedyn.io"] as const;

/** `true` quando a URL pertence a um domínio bloqueado. */
export function isBlockedSourceUrl(sourceUrl: string): boolean {
  const url = parseUrl(sourceUrl);
  if (url === null) return false;
  // Só http(s): o restante já é recusado como "invalid" na coleta.
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = normalizeHost(url.hostname);
  return BLOCKED_SOURCE_DOMAINS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** Hostname minúsculo e sem ponto final; `null` para URL inválida. */
export function hostnameOf(sourceUrl: string): string | null {
  const url = parseUrl(sourceUrl);
  return url === null ? null : normalizeHost(url.hostname);
}

function parseUrl(sourceUrl: string): URL | null {
  try {
    return new URL(sourceUrl);
  } catch {
    return null;
  }
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}
