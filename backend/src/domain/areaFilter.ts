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

export const MAX_AREA_KEYWORDS = 40;
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

/**
 * "Desenvolvimento" também nomeia cargos comerciais ("desenvolvimento de
 * clientes/negócios/vendas"). Sem nenhum termo técnico no título, essas
 * frases não devem aprovar a vaga.
 */
const NON_TECH_DEVELOPMENT_PHRASES: string[][] = [
  ["desenvolvimento", "de", "clientes"],
  ["desenvolvimento", "de", "negocios"],
  ["desenvolvimento", "de", "vendas"],
  ["desenvolvimento", "de", "mercado"],
  ["desenvolvimento", "de", "pessoas"],
  ["desenvolvimento", "de", "fornecedores"],
  ["desenvolvimento", "de", "carreira"],
  ["desenvolvimento", "comercial"],
  ["desenvolvimento", "organizacional"],
  ["desenvolvedor", "de", "clientes"],
  ["desenvolvedor", "de", "negocios"],
  ["desenvolvedor", "de", "vendas"],
  ["desenvolvedor", "comercial"],
];

/**
 * Cargos claramente fora de tecnologia. Quando o título tem um destes termos,
 * a vaga só entra se o próprio título citar um termo técnico forte: o nome da
 * empresa ("Profit-Tech") ou a estação ("Spring 2027") não bastam.
 */
const NON_TECH_TITLE_TERMS = new Set([
  "administrativo",
  "administrative",
  "marketing",
  "vendas",
  "sales",
  "comercial",
  "recrutamento",
  "recruitment",
  "direito",
  "juridico",
  "legal",
  "law",
  "policy",
  "contabilidade",
  "accounting",
  "financeiro",
  "finance",
  "communications",
  "comunicacao",
  "publicidade",
  "onboarding",
  "success",
  "sucesso",
]);

const NON_TECH_TITLE_PHRASES: string[][] = [
  ["business", "development"],
  ["talent", "acquisition"],
  ["customer", "success"],
  ["sucesso", "do", "cliente"],
  ["recursos", "humanos"],
  ["human", "resources"],
  ["administracao", "de", "empresas"],
  ["administracao", "de", "rh"],
];

/**
 * Termos que confirmam a vaga como técnica no título. A lista exclui "tech",
 * "desenvolvimento" e "desenvolvedor" de propósito: eles aparecem em nome de
 * empresa e em cargos comerciais ("desenvolvimento de negócios").
 */
const STRONG_TECH_TITLE_TERMS = new Set([
  "software",
  "developer",
  "developers",
  "engineer",
  "engineers",
  "engineering",
  "engenheiro",
  "engenharia",
  "programador",
  "programmers",
  "programming",
  "data",
  "dados",
  "analytics",
  "python",
  "java",
  "javascript",
  "typescript",
  "react",
  "node",
  "sql",
  "api",
  "cloud",
  "aws",
  "azure",
  "docker",
  "devops",
  "backend",
  "frontend",
  "fullstack",
  "mobile",
  "android",
  "ios",
  "qa",
  "infraestrutura",
  "tecnologia",
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

    const titleMatch =
      matchesTokens(titleTokens, titleCompact, needle) && !isNonTechTitleMatch(titleTokens, needle);
    const descriptionMatch =
      isDescriptionSafe(needle) && matchesTokens(descriptionTokens, descriptionCompact, needle);
    if (!titleMatch && !descriptionMatch) return false;

    // Cargo não-tech no título só passa com um termo técnico forte no título.
    // Sem isso, "Administrative Intern – Profit-Tech" entraria só por "tech" e
    // "Law, Policy… Spring 2027" entraria pela estação, não pelo framework.
    if (hasNonTechTitleRole(titleTokens) && !hasStrongTechTitleTerm(titleTokens)) return false;

    return true;
  });
}

/** Cargo claramente não-tech no título (marketing, direito, administrativo…). */
function hasNonTechTitleRole(tokens: string[]): boolean {
  if (tokens.some((token) => NON_TECH_TITLE_TERMS.has(token))) return true;
  return NON_TECH_TITLE_PHRASES.some((phrase) => containsTokenSequence(tokens, phrase));
}

/** O título cita uma tecnologia/atribuição técnica que confirma a área. */
function hasStrongTechTitleTerm(tokens: string[]): boolean {
  return tokens.some(
    (token) =>
      STRONG_TECH_TITLE_TERMS.has(token) ||
      (token.length > 4 &&
        [...STRONG_TECH_TITLE_TERMS].some((term) => term.length >= 5 && token.startsWith(term))),
  );
}

/** Ignora "desenvolvimento de clientes/negócios/..." no título. */
function isNonTechTitleMatch(titleTokens: string[], needle: string[]): boolean {
  const key = needle.join("");
  if (key !== "desenvolvimento" && key !== "desenvolvedor") return false;
  return NON_TECH_DEVELOPMENT_PHRASES.some((phrase) => containsTokenSequence(titleTokens, phrase));
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
