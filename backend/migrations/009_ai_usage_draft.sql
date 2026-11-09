-- Fase 4 (fatia 3) — rascunhos de candidatura com IA.
--
-- O rascunho de carta/respostas também consome tokens e precisa contar no teto
-- diário (AI_DAILY_BUDGET). O CHECK antigo de ai_usage só permitia
-- 'extraction', 'cv' e 'analysis'; o SQLite não altera CHECK no lugar, então a
-- tabela é reconstruída preservando os registros existentes.

CREATE TABLE ai_usage_new (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('extraction', 'cv', 'analysis', 'draft')),
  model       TEXT NOT NULL,
  tokens_in   INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out  INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  estimated   INTEGER NOT NULL DEFAULT 0 CHECK (estimated IN (0, 1)),
  created_at  TEXT NOT NULL
);

INSERT INTO ai_usage_new (id, kind, model, tokens_in, tokens_out, estimated, created_at)
SELECT id, kind, model, tokens_in, tokens_out, estimated, created_at
FROM ai_usage;

DROP TABLE ai_usage;
ALTER TABLE ai_usage_new RENAME TO ai_usage;

CREATE INDEX ix_ai_usage_created ON ai_usage(created_at);
CREATE INDEX ix_ai_usage_kind_created ON ai_usage(kind, created_at);
