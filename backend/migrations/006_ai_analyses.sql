-- Fase 3 (fatia 3) — análise de compatibilidade entre vaga e perfil.
--
-- Cada chamada da IA gera uma NOVA linha (version incremental por vaga): uma
-- re-análise nunca apaga a anterior. O score é uma sugestão explicável, não
-- uma garantia de contratação e não altera o status da vaga.
--
-- rationale_json, requirements_json, gaps_json e unknowns_json guardam a
-- saída estruturada validada por zod. raw_json fica apenas para auditoria e
-- não é devolvido pela API.

CREATE TABLE ai_analyses (
  id                INTEGER PRIMARY KEY,
  job_id            INTEGER NOT NULL REFERENCES jobs(id),
  version           INTEGER NOT NULL,
  model             TEXT NOT NULL,
  prompt_version    TEXT NOT NULL,
  score             INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  summary           TEXT NOT NULL DEFAULT '',
  rationale_json    TEXT NOT NULL,
  requirements_json TEXT NOT NULL,
  gaps_json         TEXT NOT NULL,
  unknowns_json     TEXT NOT NULL,
  recommend_apply   INTEGER NOT NULL DEFAULT 0 CHECK (recommend_apply IN (0, 1)),
  confidence        TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  raw_json          TEXT,
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  created_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_ai_analyses_job_version ON ai_analyses(job_id, version);
CREATE INDEX ix_ai_analyses_job ON ai_analyses(job_id, version DESC);
