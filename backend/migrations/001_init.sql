-- Marco 1: esquema inicial (ver docs/ESPECIFICACAO-TECNICA.md, Seção 3.2)

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id                INTEGER PRIMARY KEY,
  title             TEXT NOT NULL,
  company           TEXT,
  location          TEXT,
  work_mode         TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (work_mode IN ('remote','hybrid','onsite','unknown')),
  contract_type     TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (contract_type IN ('internship','junior','mid','senior','freelance','unknown')),
  salary_text       TEXT,
  description_text  TEXT,
  source_url        TEXT,
  discovered_at     TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','prioritized','discarded','closed')),
  status_changed_at TEXT NOT NULL,
  deleted_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_jobs_status ON jobs(status);
CREATE INDEX ix_jobs_deleted ON jobs(deleted_at);

CREATE TABLE applications (
  id                INTEGER PRIMARY KEY,
  job_id            INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
  status            TEXT NOT NULL DEFAULT 'preparing'
                    CHECK (status IN ('preparing','sent','interview','offer','rejected','withdrawn')),
  status_changed_at TEXT NOT NULL,
  applied_at        TEXT,
  deleted_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_app_status ON applications(status);

CREATE TABLE events (
  id             INTEGER PRIMARY KEY,
  job_id         INTEGER REFERENCES jobs(id),
  application_id INTEGER REFERENCES applications(id),
  type           TEXT NOT NULL,
  actor          TEXT NOT NULL CHECK (actor IN ('user','system')),
  from_value     TEXT,
  to_value       TEXT,
  message        TEXT,
  meta_json      TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_events_job ON events(job_id, created_at);
CREATE INDEX ix_events_app ON events(application_id, created_at);
CREATE INDEX ix_events_time ON events(created_at);

CREATE TABLE notes (
  id             INTEGER PRIMARY KEY,
  job_id         INTEGER NOT NULL REFERENCES jobs(id),
  application_id INTEGER REFERENCES applications(id),
  body           TEXT NOT NULL,
  deleted_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_notes_job ON notes(job_id);

CREATE TABLE backups (
  id         INTEGER PRIMARY KEY,
  file_name  TEXT NOT NULL UNIQUE,
  size_bytes INTEGER,
  kind       TEXT NOT NULL CHECK (kind IN ('manual','pre_restore')),
  created_at TEXT NOT NULL
);

-- Configurações locais essenciais (padrão inicial)
INSERT INTO settings (key, value, updated_at) VALUES
  ('display_name', '"Usuário"', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('timezone', '"America/Sao_Paulo"', strftime('%Y-%m-%dT%H:%M:%fZ','now'));