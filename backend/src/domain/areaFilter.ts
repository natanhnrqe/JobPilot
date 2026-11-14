/**
 * Filtro determinístico por área de interesse (Fase 6.3).
 *
 * A vaga entra na coleta quando:
 * - o TÍTULO contém alguma palavra/frase configurada; ou
 * - a DESCRIÇÃO contém uma tecnologia específica (Java, React, Docker…).
 *
 * Palavras genéricas (“desenvolvimento”, “sistemas”, “software”) só valem no
 * título: em descrições elas aparecem em vagas de marketing, logística e
 * administração (“desenvolvimento de atividades”, “sistemas internos”).
 *
 * A comparação ignora acentos, maiúsculas e separadores: “Front-end”,
 * “front end” e “frontend” são equivalentes. Lista vazia = sem filtro.
 */

export const MAX_AREA_KEYWORDS = 20;
export const MAX_AREA_KEYWORD_LENGTH = 50;

/**
 * Termos específicos o bastante para valer também na descrição. A lista é
 * conservadora de propósito: falso positivo é pior do que deixar de gravar.
 */
const DESCRIPTION_SAFE_TERMS = new Set([
  "angular",
  "api",
  "aws",
  "azure",
  "backend",
  "cloud",
  "css",
  "cypress",
  "django",
  "docker",
  "devops",
  "flask",
  "frontend",
  "fullstack",
  "gcp",
  "git",
  "github",
  "gitlab",
  "golang",
  "graphql",
  "html",
  "java",
  "javascript",
  "jenkins",
  "jest",
  "kotlin",
  "kubernetes",
  "laravel",
  "linux",
  "machinelearning",
  "microservices",
  "microsservicos",
  "mongodb",
  "mysql",
  "node",
  "nodejs",
  "php",
  "postgresql",
  "python",
  "rails",
  "react",
  "redis",
  "rest",
  "restful",
  "ruby",
  "rust",
  "sass",
  "scala",
  "selenium",
  "spring",
  "sql",
  "swift",
  "tailwind",
  "terraform",
  "typescript",
  "vue",
]);

/** Remove vazios, normaliza espaços e deduplica sem diferenciar acentos/caixa. */
export function normalizeAreaKeywords(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed || trimmed.length > MAX_AREA_KEYWORD_LENGTH) continue;

    const tokens = tokenize(trimmed);
    if (tokens.length === 0) continue;

    const key = tokens.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= MAX_AREA_KEYWORDS) break;
  }

  return result;
}

/** `true` quando a vaga corresponde à área (ou quando não há filtro). */
export function matchesArea(
  title: string,
  description: string,
  keywords: readonly string[],
): boolean {
  if (keywords.length === 0) return true;

  const titleTokens = tokenize(title);
  const titleCompact = titleTokens.join("");
  const descriptionTokens = tokenize(description);
  const descriptionCompact = descriptionTokens.join("");

  return keywords.some((keyword) => {
    const needle = tokenize(keyword);
    if (needle.length === 0) return false;

    if (matchesTokens(titleTokens, titleCompact, needle)) return true;
    if (!isDescriptionSafe(needle)) return false;
    return matchesTokens(descriptionTokens, descriptionCompact, needle);
  });
}

function matchesTokens(tokens: string[], compact: string, needle: string[]): boolean {
  if (containsTokenSequence(tokens, needle)) return true;

  // "frontend" também encontra "front-end" (e vice-versa). Exige ao menos
  // 5 letras para "rest" não casar com "interest".
  const compactNeedle = needle.join("");
  return compactNeedle.length >= 5 && compact.includes(compactNeedle);
}

function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length > haystack.length) return false;

  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (!tokenMatches(haystack[i + j]!, needle[j]!)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }

  return false;
}

function tokenMatches(token: string, needle: string): boolean {
  // "rest" não pode casar com "restaurantes"; "java" não pode casar com
  // "javascript" (que tem palavra-chave própria). Até 3 letras, aceita plural
  // para "api" encontrar "APIs" e "ti" encontrar "TIs".
  if (needle.length <= 4) {
    return token === needle || (needle.length <= 3 && token === `${needle}s`);
  }
  return token.startsWith(needle);
}

/** Tecnologia específica (ou frase que contenha uma) pode valer na descrição. */
function isDescriptionSafe(needle: string[]): boolean {
  return (
    needle.some((token) => DESCRIPTION_SAFE_TERMS.has(token)) ||
    DESCRIPTION_SAFE_TERMS.has(needle.join(""))
  );
}

/** Tokens minúsculos, sem acento e sem pontuação. */
export function tokenize(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "");
}
