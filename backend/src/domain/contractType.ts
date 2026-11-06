/**
 * Tipo de contrato/nível de uma vaga e classificação determinística pelo título.
 *
 * A classificação é usada apenas na coleta, quando a fonte NÃO informa o nível
 * (caso do Remote OK, que devolve tudo como `unknown`). É uma heurística
 * explícita e conservadora: só classifica quando o título tem um marcador
 * inequívoco. O resultado é gravado com `contract_type_source = 'title'`,
 * nunca como se a fonte tivesse informado.
 *
 * Ela NÃO é usada para preencher perfil, currículo ou candidaturas.
 */

export const CONTRACT_TYPES = ["internship", "junior", "mid", "senior", "freelance"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export type ContractTypeValue = ContractType | "unknown";

/** De onde veio o tipo de contrato gravado em `jobs.contract_type`. */
export const CONTRACT_TYPE_SOURCES = ["source", "title", "user", "unknown"] as const;
export type ContractTypeSource = (typeof CONTRACT_TYPE_SOURCES)[number];

export function isContractType(value: unknown): value is ContractType {
  return typeof value === "string" && (CONTRACT_TYPES as readonly string[]).includes(value);
}

interface Rule {
  type: ContractType;
  pattern: RegExp;
}

/**
 * Ordem importa: "Estágio em Desenvolvimento Júnior" é estágio; "Freelance
 * Sênior" é freelance (o usuário escolheu freelance). Os padrões usam `\b`
 * para não casar "intern" dentro de "internal"/"international".
 */
const RULES: Rule[] = [
  {
    type: "internship",
    pattern: /\b(est[áa]gi[oa]s?|est[áa]gi[áa]ri[oa]s?|internship|interns?)\b/i,
  },
  {
    type: "freelance",
    pattern: /\b(freelance|freelancer|freelancers)\b/i,
  },
  {
    type: "junior",
    pattern: /\b(j[úu]nior(?:es)?|jr|trainee|entry[\s-]?level)\b/i,
  },
  {
    type: "mid",
    pattern: /\b(pleno|mid[\s-]?level)\b/i,
  },
  {
    type: "senior",
    pattern: /\b(s[êe]nior(?:es)?|sr|staff|principal|lead|head|manager|director|architect)\b/i,
  },
];

/**
 * Classifica o tipo de contrato a partir do título.
 * Devolve `null` quando não há marcador claro — o chamador decide o que fazer
 * (normalmente manter `unknown`, jamais inventar um nível).
 */
export function inferContractTypeFromTitle(title: string): ContractType | null {
  const value = title.trim();
  if (value === "") return null;

  for (const rule of RULES) {
    if (rule.pattern.test(value)) return rule.type;
  }
  return null;
}
