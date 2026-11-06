import type { Db } from "../db/connection.js";
import { CONTRACT_TYPES, isContractType, type ContractType } from "../domain/contractType.js";

/**
 * Preferências de busca aplicadas na coleta diária (migração 004).
 *
 * Linha única (`id = 1`). `contractTypes` vazio significa "não filtrar por
 * tipo de contrato" — mesmo comportamento de antes da migração.
 */
export interface SearchPreferences {
  contractTypes: ContractType[];
  includeUnknownContractType: boolean;
  updatedAt: string;
}

/** Padrão da migração 004: escolha inicial do usuário (editável na UI). */
export const DEFAULT_SEARCH_PREFERENCES = {
  contractTypes: ["internship", "junior", "freelance"] as ContractType[],
  includeUnknownContractType: false,
};

interface PreferencesRow {
  contract_types: string;
  include_unknown_contract_type: number;
  updated_at: string;
}

export function getSearchPreferences(db: Db): SearchPreferences {
  const row = db.get<PreferencesRow>(
    "SELECT contract_types, include_unknown_contract_type, updated_at FROM search_preferences WHERE id = 1",
  );
  if (!row) {
    return {
      ...DEFAULT_SEARCH_PREFERENCES,
      contractTypes: [...DEFAULT_SEARCH_PREFERENCES.contractTypes],
      updatedAt: "",
    };
  }

  return {
    // JSON corrompido falha aberto (sem filtro) para nunca esconder vagas por
    // causa de um dado inválido; a UI permite corrigir e salvar de novo.
    contractTypes: parseContractTypes(row.contract_types),
    includeUnknownContractType: row.include_unknown_contract_type === 1,
    updatedAt: row.updated_at,
  };
}

export interface SearchPreferencesInput {
  contractTypes?: ContractType[];
  includeUnknownContractType?: boolean;
}

/** Atualiza só os campos informados e devolve o estado final. */
export function setSearchPreferences(db: Db, input: SearchPreferencesInput): SearchPreferences {
  const current = getSearchPreferences(db);
  const contractTypes = input.contractTypes ?? current.contractTypes;
  const includeUnknown = input.includeUnknownContractType ?? current.includeUnknownContractType;
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO search_preferences (id, contract_types, include_unknown_contract_type, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       contract_types = excluded.contract_types,
       include_unknown_contract_type = excluded.include_unknown_contract_type,
       updated_at = excluded.updated_at`,
    [JSON.stringify(contractTypes), includeUnknown ? 1 : 0, now],
  );

  return getSearchPreferences(db);
}

function parseContractTypes(raw: string): ContractType[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<ContractType>();
  for (const value of parsed) {
    if (isContractType(value)) seen.add(value);
  }
  // Mantém a ordem canônica (estável na UI e nos testes).
  return CONTRACT_TYPES.filter((type) => seen.has(type));
}
