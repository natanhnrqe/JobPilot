-- Fase 3 (fatia 1) — preferências de busca aplicadas na coleta diária.
--
-- 1) search_preferences: linha única (id = 1) com os filtros do usuário.
--    - contract_types: JSON array; vazio = não filtra por tipo de contrato.
--    - include_unknown_contract_type: 1 mantém vagas cujo nível a fonte não
--      informa e o título não permite classificar.
-- 2) jobs.contract_type_source: de onde veio o tipo de contrato.
--    - 'source': a fonte informou;
--    - 'title':  inferido do título (heurística explícita);
--    - 'user':   o usuário definiu/confirmou;
--    - 'unknown': não informado.
--
-- Padrão inicial escolhido pelo usuário: estágio, júnior/trainee e freelance,
-- sem vagas de nível desconhecido. Ajustável em Configurações → Preferências
-- de busca (não altera vagas já cadastradas).

CREATE TABLE search_preferences (
  id                            INTEGER PRIMARY KEY CHECK (id = 1),
  contract_types                TEXT NOT NULL,
  include_unknown_contract_type INTEGER NOT NULL DEFAULT 0,
  updated_at                    TEXT NOT NULL
);

INSERT INTO search_preferences (id, contract_types, include_unknown_contract_type, updated_at)
VALUES (1, '["internship","junior","freelance"]', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

ALTER TABLE jobs ADD COLUMN contract_type_source TEXT NOT NULL DEFAULT 'unknown';
