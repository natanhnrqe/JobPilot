-- Fase 2 (cadastro assistido por IA): data de publicação da vaga.
-- Motivo (Seção 3.3 da especificação): o campo existia no esquema original e é
-- necessário para registrar a data REALMENTE informada pela fonte — nunca a data
-- atual. Nullable: compatível com todos os registros existentes (ficam NULL).

ALTER TABLE jobs ADD COLUMN posted_at TEXT;
