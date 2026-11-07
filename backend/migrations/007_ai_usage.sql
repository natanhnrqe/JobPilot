-- Fase 3 (fatia 4) — uso e orçamento diário de IA.
--
-- Cada chamada bem-sucedida ao provedor (extração de vaga, importação de CV ou
-- análise de compatibilidade) grava uma linha em ai_usage. O total do dia é
-- comparado com AI_DAILY_BUDGET antes da próxima chamada: ao atingir o teto,
-- a chamada é recusada com aviso claro (nada é enviado ao provedor).
--
-- tokens_in/tokens_out vêm do provedor quando ele informa `usage`; caso
-- contrário, são estimados (≈4 caracteres/token) e `estimated` fica 1.

CREATE TABLE ai_usage (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('extraction', 'cv', 'analysis')),
  model       TEXT NOT NULL,
  tokens_in   INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out  INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  estimated   INTEGER NOT NULL DEFAULT 0 CHECK (estimated IN (0, 1)),
  created_at  TEXT NOT NULL
);

CREATE INDEX ix_ai_usage_created ON ai_usage(created_at);
CREATE INDEX ix_ai_usage_kind_created ON ai_usage(kind, created_at);

-- Análises já gravadas antes desta migração passam a contar no histórico de uso.
-- (O teto diário só considera o dia corrente; o backfill preserva a auditoria.)
INSERT INTO ai_usage (kind, model, tokens_in, tokens_out, estimated, created_at)
SELECT
  'analysis',
  model,
  COALESCE(tokens_in, 0),
  COALESCE(tokens_out, 0),
  CASE WHEN tokens_in IS NULL OR tokens_out IS NULL THEN 1 ELSE 0 END,
  created_at
FROM ai_analyses;
