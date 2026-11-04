-- Fase 2 — coleta de fontes reais (Seção 3.3 da especificação).
--
-- 1) sources: registro das fontes com estado de suporte (unverified|verified|broken|blocked).
-- 2) search_runs: uma linha por execução de coleta (manual ou agendada).
-- 3) execution_logs: passo a passo de cada execução (diagnóstico de falhas por fonte).
-- 4) jobs ganha source_id + external_id para a deduplicação por identificador
--    estável da fonte (Seção 6.2, precedência 1). Colunas nullable: todos os
--    registros existentes (cadastro manual e assistido) continuam válidos.

CREATE TABLE sources (
  id            INTEGER PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  support_state TEXT NOT NULL DEFAULT 'unverified',
  verified_at   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE search_runs (
  id                INTEGER PRIMARY KEY,
  trigger           TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL,
  discovered_count  INTEGER NOT NULL DEFAULT 0,
  new_count         INTEGER NOT NULL DEFAULT 0,
  updated_count     INTEGER NOT NULL DEFAULT 0,
  duplicate_count   INTEGER NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  summary           TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE execution_logs (
  id          INTEGER PRIMARY KEY,
  run_id      INTEGER REFERENCES search_runs(id),
  job_type    TEXT NOT NULL,
  level       TEXT NOT NULL,
  step        TEXT,
  message     TEXT NOT NULL,
  meta_json   TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX ix_logs_run ON execution_logs(run_id, created_at);

ALTER TABLE jobs ADD COLUMN source_id INTEGER REFERENCES sources(id);
ALTER TABLE jobs ADD COLUMN external_id TEXT;

-- Deduplicação por fonte+id externo apenas entre vagas ativas: se o usuário
-- excluir a vaga, a próxima coleta pode criá-la de novo.
CREATE UNIQUE INDEX ux_jobs_source_external
  ON jobs(source_id, external_id)
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL AND deleted_at IS NULL;
