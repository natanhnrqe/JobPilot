-- Fase 6.3 — filtro por área de interesse na coleta diária.
--
-- area_keywords: JSON array de palavras/frases. Vazio = não filtra por área.
-- A vaga entra quando o título ou a descrição contém alguma palavra-chave
-- (comparação sem acentos/maiúsculas, por token/frase; ver domain/areaFilter.ts).
--
-- Exemplos: ["desenvolvimento","backend","java","react","typescript"].
-- Ajustável em Configurações → Preferências de busca; não altera vagas já
-- cadastradas (a exclusão dessas continua sendo manual e reversível).

ALTER TABLE search_preferences ADD COLUMN area_keywords TEXT NOT NULL DEFAULT '[]';
