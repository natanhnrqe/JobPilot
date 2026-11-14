# JobPilot — Especificação Técnica v1.1

**Status:** Fases 1–5 implementadas e Fase 6 em andamento (Nube, JSearch e filtro por área; atualizado em 2026-11-13). O envio automatizado nos portais permanece **fora de escopo** por decisão registrada em `docs/PORTAIS.md`.
**Relação com o escopo:** detalha tecnicamente o `docs/ESCOPO.md` v1.1. Não substitui o escopo; quando divergirem, o escopo prevalece em requisitos funcionais.
**Marco atual:** Fases 6.1 e 6.2 concluídas — conector Nube (estágios em Curitiba/Grande Curitiba e home office) e conector JSearch/RapidAPI (estágios em Curitiba e remotos), ambos com cache e validação real pelo pipeline. O filtro por área (6.5) também está implementado: a coleta só grava vagas cujo título contém uma palavra-chave da área ou cuja descrição cita uma tecnologia específica. As fases 1–5 (fundação, coleta, IA, candidatura assistida, lembretes e consolidação) estão implementadas e cobertas por testes. Adzuna e Jooble continuam pendentes de chave.

## 1. Princípios e decisões estruturais

1. **Dashboard como núcleo do produto.** Todo o restante (coleta, IA, automação) existe para alimentar o dashboard.
2. **Um só processo de aplicação, modular, sem microsserviços.** Backend único Node.js + TypeScript que expõe a API HTTP e também contém os módulos de coleta, IA e automação, acionáveis por linha de comando.
3. **Dois executáveis distintos:** o servidor da API (`npm run dev` / `npm start`) e o CLI de execução agendada (`npm run run:job` — `src/cli/run-job.ts`). O agendador do Windows chama apenas o CLI. O servidor precisa estar ligado apenas quando o usuário abre o dashboard.
4. **Banco SQLite em arquivo único**, com `journal_mode=WAL`. Nenhum servidor de banco sempre ligado.
5. **Pragmatismo sobre elegância:** preferir código explícito e pequeno a abstrações genéricas (ex.: conector por fonte é uma interface simples, não um framework de plugins).
6. **Verdade acima de tudo:** status de candidatura só muda para "enviada" com evidência registrada. Tentativa ≠ envio.
7. **Nada de envio automático sem autorização explícita e revogável.**
8. **Nada será declarado "suportado" antes de verificado em teste real contra o portal.**

## 2. Estrutura do projeto recomendada

Repositório único, com workspaces npm.

```
jobpilot/
├─ package.json               # workspaces: ["backend","frontend"]
├─ tsconfig.base.json
├─ .gitignore                 # data/, .env, *.sqlite*
├─ .env.example               # sem segredos reais
├─ README.md
├─ docs/
│  ├─ ESCOPO.md                # já existente
│  ├─ ESPECIFICACAO-TECNICA.md # este documento
│  ├─ INSTALACAO.md            # (Marco 1)
│  ├─ BACKUP-RESTORE.md        # (Marco 1)
│  └─ FONTES.md                # (Fase 2) status de verificação de cada fonte/portal
├─ backend/
│  ├─ package.json
│  ├─ migrations/              # SQL versionado (001_init.sql, ...)
│  ├─ scripts/migrate.ts       # runner de migrações
│  ├─ src/
│  │  ├─ config/               # carrega .env + defaults, valida com zod
│  │  ├─ db/                   # conexão node:sqlite, transações, helpers
│  │  ├─ http/
│  │  │  ├─ server.ts          # Express + rotas + error handler
│  │  │  ├─ routes/            # uma pasta por recurso
│  │  │  └─ middleware/        # validação (zod), envelope de erro
│  │  ├─ domain/
│  │  │  ├─ statuses.ts        # máquinas de estado (fonte única de verdade)
│  │  │  ├─ jobs.ts            # regras de vaga (incl. exclusão/restauração)
│  │  │  ├─ applications.ts    # regras de candidatura
│  │  │  └─ errors.ts
│  │  ├─ repositories/         # acesso a dados (SQL) — um arquivo por tabela
│  │  ├─ services/             # casos de uso (orquestro repositórios + domínio)
│  │  ├─ backup/               # backup (VACUUM INTO) e restauração validada
│  │  ├─ logging/              # logger próprio (console + data/logs/)
│  │  └─ cli/                  # migrate, backup, restore
│  └─ tests/                   # unit/, integration/, backup/
├─ frontend/
│  ├─ package.json
│  ├─ index.html
│  ├─ vite.config.ts           # proxy /api → 127.0.0.1:3000
│  └─ src/
│     ├─ api/                  # cliente HTTP + tipos compartilhados
│     ├─ pages/                # Dashboard, Vagas, DetalheVaga, DetalheCandidatura, Configuracoes
│     ├─ components/           # StatusBadge, EventTimeline, NoteList, modais
│     ├─ lib/                  # formatação de data (fuso), fetch wrapper
│     └─ styles.css
├─ data/                       # NÃO versionado: banco, backups, logs
└─ scripts/
   └─ install-task.ps1         # (Fase 2) cria a tarefa do Windows às 18:00
```

> No Marco 1, pastas de `connectors/`, `collect/`, `ai/`, `automation/`, `scheduler/` e `reminders/` **não são criadas** — chegam com as respectivas fases. `scripts/install-task.ps1` também não.

**Decisões de ferramenta (Marco 1 — ver Seção 14.1):**

| Área      | Ferramenta                                   | Justificativa                               |
| --------- | -------------------------------------------- | ------------------------------------------- |
| HTTP      | Express + zod                                | simples, maduro, validação integrada        |
| Banco     | `node:sqlite` (nativo)                       | zero dependência nativa, WAL, `VACUUM INTO` |
| Migrações | arquivos `.sql` versionados + runner próprio | idempotente, auditável                      |
| Frontend  | Vite + React + TypeScript                    | simples, sem framework pesado               |
| Testes    | Vitest + supertest                           | offline, banco temporário                   |
| Logs      | logger próprio                               | console + arquivo diário                    |

**Estrutura de configuração:**

- `.env` (versionado apenas o `.env.example`): `PORT`, `HOST`, `DATABASE_PATH`, `DATA_DIR`. **Sem segredos no Marco 1.**
- Tabela `settings` (no banco): `display_name`, `timezone` — editáveis pela UI (Configurações).

## 3. Modelo de dados e esquema SQLite

### 3.1 Entidades

**Marco 1 (implementadas agora):**

- **Job (Vaga)** — uma oportunidade cadastrada **manualmente** pelo usuário. Possui `status` próprio e pode ser excluída (soft delete).
- **Application (Candidatura)** — registro criado **somente quando o usuário decide acompanhar uma candidatura** para uma vaga. Relação **1:1 com a Job** (`job_id UNIQUE`). Possui `status` próprio, **totalmente independente** do status da vaga.
- **Event** — histórico imutável do que aconteceu (criação, mudança de status, exclusão/restauração, nota adicionada).
- **Note** — anotações ligadas a uma vaga (e opcionalmente à candidatura dessa vaga).
- **Setting** — configurações locais essenciais (nome de exibição, fuso horário).
- **Backup** — registro dos arquivos de backup gerados (o arquivo em si vive em `data/backups/`).

**Marcos futuros (NÃO criadas no Marco 1):** Profile (currículo), SearchRun/ExecutionLog, Reminder, Source/Portal, AutomationRule, SendAttempt, AiAnalysis, Credencial.

### 3.2 Esquema SQL do Marco 1 (migrations iniciais)

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,         -- ex.: 'display_name', 'timezone'
  value      TEXT NOT NULL,            -- JSON
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
  source_url        TEXT,              -- URL original (opcional; validada quando informada)
  discovered_at     TEXT NOT NULL,     -- data de descoberta/cadastro (ISO-8601 UTC)
  status            TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','prioritized','discarded','closed')),  -- ver Seção 5.1
  status_changed_at TEXT NOT NULL,
  deleted_at        TEXT,              -- soft delete (exclusão preserva histórico)
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_jobs_status ON jobs(status);
CREATE INDEX ix_jobs_deleted ON jobs(deleted_at);

CREATE TABLE applications (
  id                INTEGER PRIMARY KEY,
  job_id            INTEGER NOT NULL UNIQUE REFERENCES jobs(id),  -- relação 1:1
  status            TEXT NOT NULL DEFAULT 'preparing'
                    CHECK (status IN ('preparing','sent','interview','offer','rejected','withdrawn')), -- ver Seção 5.2
  status_changed_at TEXT NOT NULL,
  applied_at        TEXT,              -- data do envio declarada pelo usuário ao marcar como 'sent'
  deleted_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_app_status ON applications(status);

CREATE TABLE events (
  id             INTEGER PRIMARY KEY,
  job_id         INTEGER REFERENCES jobs(id),
  application_id INTEGER REFERENCES applications(id),
  type           TEXT NOT NULL,        -- ver lista em 5.4
  actor          TEXT NOT NULL CHECK (actor IN ('user','system')),
  from_value     TEXT,
  to_value       TEXT,
  message        TEXT,
  meta_json      TEXT,                 -- dados extras estruturados
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_events_job ON events(job_id, created_at);
CREATE INDEX ix_events_app ON events(application_id, created_at);
CREATE INDEX ix_events_time ON events(created_at);

CREATE TABLE notes (
  id             INTEGER PRIMARY KEY,
  job_id         INTEGER NOT NULL REFERENCES jobs(id),
  application_id INTEGER REFERENCES applications(id),  -- quando a nota é da candidatura daquela vaga
  body           TEXT NOT NULL,
  deleted_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_notes_job ON notes(job_id);

CREATE TABLE backups (
  id         INTEGER PRIMARY KEY,
  file_name  TEXT NOT NULL UNIQUE,     -- nome do arquivo em data/backups/
  size_bytes INTEGER,
  kind       TEXT NOT NULL,            -- manual | pre_restore
  created_at TEXT NOT NULL
);
```

### 3.3 Esquema das fases 2–5 (implementado)

As tabelas abaixo foram adicionadas por migrações incrementais (002–010). `jobs` e `applications` **não** foram recriadas: ganharam colunas novas (ex.: `posted_at`, `source_id`, `external_id`, `contract_type_source`, `portal_key`, `evidence_url`) por migrações incrementais.

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE profile (
  id                INTEGER PRIMARY KEY,
  version           INTEGER NOT NULL DEFAULT 1,
  raw_cv_text       TEXT,              -- texto extraído do CV importado
  cv_file_path      TEXT,              -- caminho local do arquivo (não versionado)
  extracted_json    TEXT NOT NULL,     -- JSON estruturado extraído pela IA (revisável)
  preferences_json  TEXT NOT NULL,     -- cargos, modalidade, localização, pretensão, idiomas
  answers_json      TEXT NOT NULL DEFAULT '{}', -- respostas padrão para formulários
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE sources (
  id            INTEGER PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,  -- ex.: 'remotive', 'remoteok', 'linkedin'
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,         -- 'api' | 'html' | 'browser'
  enabled       INTEGER NOT NULL DEFAULT 1,
  support_state TEXT NOT NULL DEFAULT 'unverified', -- unverified|verified|broken|blocked
  verified_at   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- jobs, applications, events e notes já existem (Seção 3.2); futuras migrações
-- apenas adicionam colunas (ex.: dedupe_key, source_id, payload_json em jobs;
-- portal_id, next_follow_up_at, automation_enabled em applications).

-- (removido também: settings, já criado na Seção 3.2)

CREATE TABLE reminders (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  due_at         TEXT NOT NULL,
  kind           TEXT NOT NULL,        -- follow_up|deadline|interview|custom
  message        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|done|dismissed
  triggered_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_reminders_due ON reminders(status, due_at);

CREATE TABLE search_runs (
  id                INTEGER PRIMARY KEY,
  trigger           TEXT NOT NULL,     -- 'scheduled' | 'manual'
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL,     -- running|success|partial|failed|skipped
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
  run_id      INTEGER REFERENCES search_runs(id),  -- null para execuções avulsas (envio, lembrete)
  job_type    TEXT NOT NULL,           -- 'collect' | 'ai_analyze' | 'send' | 'reminders' | 'backup'
  level       TEXT NOT NULL,           -- debug|info|warn|error
  step        TEXT,                    -- ex.: 'source.remotive.fetch'
  message     TEXT NOT NULL,
  meta_json   TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX ix_logs_run ON execution_logs(run_id, created_at);

CREATE TABLE ai_analyses (
  id          INTEGER PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id),
  version     INTEGER NOT NULL,
  model       TEXT NOT NULL,
  score       INTEGER,                 -- 0..100
  summary     TEXT,
  rationale   TEXT NOT NULL,           -- justificativas em texto
  gaps_json   TEXT NOT NULL,           -- requisitos faltantes/desconhecidos
  raw_json    TEXT,                    -- saída bruta do modelo (auditoria)
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX ix_ai_job ON ai_analyses(job_id, version);

CREATE TABLE portals (
  id            INTEGER PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,  -- ex.: 'greenhouse', 'lever', 'ashby'
  name          TEXT NOT NULL,
  support_state TEXT NOT NULL DEFAULT 'unverified', -- unverified|verified|broken|blocked|captcha_required
  auth_kind     TEXT,                  -- none|cookie|password
  verified_at   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE automation_rules (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 0,
  min_score          INTEGER,          -- pontuação mínima de compatibilidade
  allowed_contract   TEXT,             -- JSON array: ['internship','junior']
  allowed_sources    TEXT,             -- JSON array de source.key; vazio = nenhuma
  allowed_portals    TEXT,             -- JSON array de portal.key; vazio = nenhuma
  blocked_companies  TEXT,             -- JSON array
  max_sends_per_day  INTEGER NOT NULL DEFAULT 0,  -- 0 = bloqueado
  requires_confirm   INTEGER NOT NULL DEFAULT 1,  -- exige confirmação na UI antes do envio
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE send_attempts (
  id              INTEGER PRIMARY KEY,
  application_id  INTEGER NOT NULL REFERENCES applications(id),
  rule_id         INTEGER REFERENCES automation_rules(id),
  status          TEXT NOT NULL,       -- prepared|blocked|attempted|confirmed|failed|needs_human
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  portal_key      TEXT,
  portal_url      TEXT,
  evidence_json   TEXT,                -- captura/recibo/código de confirmação quando houver
  error_code      TEXT,                -- captcha|auth_required|blocked|timeout|validation|unknown
  error_message   TEXT,
  steps_json      TEXT NOT NULL,       -- passo a passo executado
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_send_app ON send_attempts(application_id, created_at);

CREATE TABLE credentials (
  id           INTEGER PRIMARY KEY,
  portal_key   TEXT NOT NULL,
  label        TEXT NOT NULL,
  ciphertext   TEXT NOT NULL,          -- cifrado com ENCRYPTION_KEY
  iv           TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- backups já existe (Seção 3.2); migração futura apenas adiciona coluna
-- 'scheduled' para o backup automático agendado.
```

### 3.4 Regras de persistência

- Todos os timestamps em **ISO-8601 UTC** (`2026-11-03T18:00:00.000Z`); a UI converte para o fuso local configurado.
- Nenhum UPDATE "silencioso" de status: toda mudança de estado passa por `domain/statuses.ts`, que valida a transição, grava o registro e insere o `event` na **mesma transação**.
- **Exclusão = soft delete** (`deleted_at`). Nada é removido fisicamente de `jobs`, `applications`, `events` ou `notes` no Marco 1:
  - `DELETE /jobs/:id` marca a vaga **e** a candidatura associada (se existir) como excluídas e gera `job.deleted` (+ `application.deleted`);
  - `DELETE /applications/:id` marca só a candidatura e gera `application.deleted`;
  - `POST /jobs/:id/restore` restaura vaga + candidatura e gera `job.restored`;
  - listagens e dashboard filtram `deleted_at IS NULL`, com opção explícita de "mostrar excluídas".
  - Isso garante integridade referencial: FKs nunca ficam órfãs e o histórico permanece consultável.
- **Nenhuma coluna de prioridade numérica no Marco 1.** A marcação de prioridade é o status `prioritized` da vaga. `priority`/`priority_source` só serão adicionados junto com a análise por IA (Fase 3), quando a origem do valor (IA × manual) passar a existir de fato.

## 4. Contratos de API (HTTP/JSON)

- Base: `http://localhost:3000/api/v1`
- Erro padrão: `{ "error": { "code": "JOB_NOT_FOUND", "message": "...", "details": {} } }`
- HTTP: 200 ok, 201 criado, 204 sem conteúdo, 400 validação, 401 não autenticado, 404 inexistente, 409 conflito de estado, 429 limite, 500 interno.
- zod na entrada e na saída de todos os endpoints.
- **Auth local:** por padrão o servidor escuta apenas em `127.0.0.1` sem login. Opcionalmente token estático no `.env` enviado como header `X-JobPilot-Token` (recomendado se exposto na LAN). Decisão na Seção 14.

> **Marco 1:** apenas os endpoints marcados abaixo como `[M1]`. Os demais pertencem a fases futuras e **não devem ser implementados agora** (não criar rotas decorativas nem dados simulados para eles).

### 4.1 Dashboard

| Método     | Rota                         | Descrição                                                                                                                                                                                                                                         |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `[M1]` | `/dashboard`                 | agregado real do banco: total de vagas, vagas por status (novas, prioritárias, descartadas, encerradas), candidaturas por status (em preparação, enviadas, entrevistas, ofertas, rejeições, retiradas), excluídas, mais as 10 atividades recentes |
| GET `[M1]` | `/activity?limit=50&before=` | feed de eventos recentes (com título da vaga)                                                                                                                                                                                                     |

### 4.2 Vagas

| Método        | Rota                                                                             | Descrição                                                                       |
| ------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET `[M1]`    | `/jobs?status=&workMode=&contractType=&q=&includeDeleted=&sort=&page=&pageSize=` | lista paginada com filtros e busca local (título/empresa)                       |
| GET `[M1]`    | `/jobs/:id`                                                                      | detalhe + notas + eventos + candidatura associada                               |
| POST `[M1]`   | `/jobs`                                                                          | criação manual (título obrigatório; demais campos opcionais)                    |
| PATCH `[M1]`  | `/jobs/:id`                                                                      | edição de campos editáveis + mudança de status validada pela máquina de estados |
| DELETE `[M1]` | `/jobs/:id`                                                                      | exclusão (soft delete; preserva histórico e candidatura)                        |
| POST `[M1]`   | `/jobs/:id/restore`                                                              | restaura vaga excluída (e sua candidatura)                                      |
| POST `[M1]`   | `/jobs/:id/notes`                                                                | adiciona nota à vaga                                                            |
| PATCH `[M1]`  | `/notes/:id`                                                                     | edita nota                                                                      |
| DELETE `[M1]` | `/notes/:id`                                                                     | exclui nota (soft delete)                                                       |
| POST          | `/jobs/:id/analyze`                                                              | Fase 3 — análise por IA                                                         |
| GET           | `/jobs/:id/analyses`                                                             | Fase 3 — histórico de análises                                                  |
| POST          | `/jobs/:id/priority`                                                             | Fase 3 — prioridade numérica (não existe no Marco 1)                            |

### 4.3 Candidaturas

| Método        | Rota                                             | Descrição                                                                         |
| ------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| GET `[M1]`    | `/applications?status=&q=&includeDeleted=&page=` | lista com filtros                                                                 |
| GET `[M1]`    | `/applications/:id`                              | detalhe + eventos + notas da candidatura                                          |
| POST `[M1]`   | `/jobs/:id/application`                          | cria a candidatura da vaga (1:1; status inicial `preparing`; `409` se já existir) |
| PATCH `[M1]`  | `/applications/:id`                              | edição + transição de status validada (`applied_at` é definido ao marcar `sent`)  |
| DELETE `[M1]` | `/applications/:id`                              | exclusão (soft delete)                                                            |
| POST          | `/applications/:id/events`                       | Fase 5 — evento manual                                                            |
| POST ✅       | `/applications/:id/follow-up`                    | Fase 5 — lembrete de acompanhamento (implementado na fatia 5.1)                   |
| POST ✅       | `/applications/:id/reminders/:id/complete`       | Fase 5 — concluir lembrete (implementado na fatia 5.1)                            |

### 4.4 Perfil — **Fase 3 (não implementar no Marco 1)**

| Método  | Rota                  | Descrição                      |
| ------- | --------------------- | ------------------------------ |
| GET/PUT | `/profile`            | preferências e respostas       |
| POST    | `/profile/cv`         | upload e extração de currículo |
| POST    | `/profile/cv/confirm` | confirmação da versão revisada |

### 4.5 Execuções e fontes — **Fase 2 (não implementar no Marco 1)**

**No Marco 1 não existe busca automática nem manual:** as vagas são cadastradas pelo usuário. Não haverá rota `/runs` nem `/sources` antes de existir ao menos um conector funcional verificado.

**Implementado na Fase 2 (somente leitura):**

| Método | Rota         | Descrição                                                                 |
| ------ | ------------ | ------------------------------------------------------------------------- |
| GET    | `/runs`      | histórico de execuções + resumo de `data/last-run.json`                   |
| GET    | `/runs/:id`  | uma execução com o passo a passo de `execution_logs`                      |
| GET    | `/sources`   | fontes com `support_state`, `verified_at` e `enabled`                     |

**Ainda não implementado (Fase 2):** `POST /runs` (disparar coleta pela API — hoje só via CLI/agendador) e `PATCH /sources/:id` (habilitar/desabilitar fonte pela UI).

### 4.6 IA — extração (Fase 2) e análise (Fase 3)

**Implementado na Fase 2 (cadastro assistido por IA):**

| Método | Rota                   | Descrição                                                                            |
| ------ | ---------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/extractions/status`  | `{ enabled, model, provider }` — `enabled=false` quando não há `AI_API_KEY`           |
| POST   | `/extractions/from-text` | extrai rascunho de texto colado e devolve prévia; **não persiste nada**             |
| POST   | `/extractions/from-url`  | busca a página com proteções SSRF, converte HTML em texto e extrai; **não persiste** |

- A gravação usa o **mesmo** `POST /jobs` (regras, eventos e validação existentes) e só ocorre após confirmação humana na prévia.
- Erros novos: `AI_UNAVAILABLE` (503, sem chave/falha de rede/cota), `AI_INVALID_RESPONSE` (502, JSON ou esquema inválidos após 2 tentativas), `FETCH_ERROR` (falha/bloqueio ao obter a URL).

**Ainda Fase 3 (não implementar):**

| Método | Rota                 | Descrição         |
| ------ | -------------------- | ----------------- |
| POST   | `/jobs/bulk-analyze` | análise em lote   |
| GET    | `/ai/usage`          | consumo de tokens |

### 4.7 Candidatura assistida — **Fase 4**

> **Decisão de 2026-11-08:** os portais-alvo (Gupy, LinkedIn, Indeed e Glassdoor)
> vedam bots/automação de candidatura. A Fase 4 é **assistida**: o JobPilot
> prepara os dados e registra o envio declarado; **nunca** envia nada sozinho.
> Ver `docs/PORTAIS.md`.

| Método | Rota                                | Descrição                                                                      |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------ |
| GET    | `/jobs/:id/application-kit`         | perfil + respostas + última análise + checklist + portal detectado             |
| POST   | `/jobs/:id/application-draft`       | rascunho de carta/respostas por IA, com citações verificadas (não envia nada) |
| POST   | `/jobs/:id/application/mark-sent`   | registra o envio **declarado** (data e evidência opcionais; cria a candidatura) |
| PATCH  | `/applications/:id`                 | transições + `appliedAt` + `evidenceUrl` (só quando `sent`)                    |

Rotas de automação (`/automation/*`, `/send-attempts`, `/portals`) **não
existem** e não serão criadas enquanto os portais-alvo vedarem bots.

### 4.8 Sistema

| Método         | Rota        | Descrição                                                                                     |
| -------------- | ----------- | --------------------------------------------------------------------------------------------- |
| GET `[M1]`     | `/health`   | `{ ok, db, version }`                                                                         |
| POST `[M1]`    | `/backups`  | cria backup do banco agora (arquivo em `data/backups/`) e registra em `backups`               |
| GET `[M1]`     | `/backups`  | lista de backups com tamanho e data                                                           |
| POST `[M1]`    | `/restore`  | restaura de um backup: valida integridade, faz backup prévio automático, substitui e revalida |
| GET/PUT `[M1]` | `/settings` | configurações locais essenciais (nome de exibição, fuso horário)                              |

### 4.9 Exportação — **Fase 5.3**

| Método | Rota                                    | Descrição                                                                 |
| ------ | --------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/exports/:entity?format=csv\|json`     | exporta `jobs`, `applications` ou `events`, incluindo excluídos; padrão CSV |

- `Content-Disposition: attachment` com nome `jobpilot-<entity>-<data>.<formato>`.
- CSV com BOM UTF-8, campos escapados (RFC 4180) e neutralização de fórmulas de planilha.
- JSON: `{ exportedAt, entity, count, items }`.
- Rota somente leitura: não altera o banco nem acessa a rede.

## 5. Estados e transições

Implementar como **máquina de estados declarativa** em `domain/statuses.ts`: mapa `{status → [transições permitidas]}` + função `transition(entity, to, actor, meta)` que (a) valida, (b) grava, (c) insere `event`, (d) executa efeitos colaterais — tudo numa transação. A API responde `409` para transição inválida.

### 5.1 Status da vaga (`jobs.status`) — Marco 1

| Código        | Rota traduzida | Significado                                     |
| ------------- | -------------- | ----------------------------------------------- |
| `new`         | Nova           | cadastrada, ainda não priorizada nem descartada |
| `prioritized` | Priorizada     | marcada pelo usuário como alvo de candidatura   |
| `discarded`   | Descartada     | descartada pelo usuário                         |
| `closed`      | Encerrada      | vaga saiu do ar ou foi preenchida               |

Transições permitidas (Marco 1):

```
new         → prioritized | discarded | closed
prioritized → discarded | closed | new        (desmarcar)
discarded   → new | closed                    (reabrir)
closed      → new                             (reabrir)
```

Observações:

- Não existe prioridade numérica nem origem de prioridade (`priority_source`) no Marco 1 — a marcação é o próprio status `prioritized`. As colunas só entram na Fase 3, quando passarem a ter origem real (IA × manual).
- Os estados `analyzing` e `analyzed` pertencem à Fase 3 (IA) e **não são criados agora**.
- Exclusão não é status: usa `deleted_at` (Seção 3.4) e não altera `status`.
- A regra de "fonte marcar `closed` sozinha" só existe a partir da Fase 2 (coleta); no Marco 1 `closed` é sempre uma ação do usuário.

### 5.2 Status da candidatura (`applications.status`) — Marco 1

**Quando o registro é criado:** somente quando o usuário pede para acompanhar uma candidatura da vaga (`POST /jobs/:id/application`). Relação **1:1** (`job_id UNIQUE`). Status inicial: `preparing`. Enquanto não houver registro, a vaga simplesmente "não tem candidatura" — não existe status `not_started` armazenado.

| Código      | Significado                                                  |
| ----------- | ------------------------------------------------------------ |
| `preparing` | Em preparação (materiais, formulário, revisão)               |
| `sent`      | **Enviada — declaração manual do usuário**, com `applied_at` |
| `interview` | Entrevista marcada                                           |
| `offer`     | Oferta recebida                                              |
| `rejected`  | Rejeitada                                                    |
| `withdrawn` | Retirada pelo usuário                                        |

Transições permitidas (Marco 1):

```
preparing → sent | withdrawn
sent      → interview | offer | rejected | withdrawn
interview → offer | rejected | withdrawn
offer     → withdrawn
rejected  → (terminal)
withdrawn → preparing                       (reabrir)
```

**Regras do Marco 1:**

1. **Não existe envio automático.** Todo `→ sent` é uma ação explícita do usuário, com data (`applied_at`) informada ou assumida como agora. O sistema nunca muda status sozinho.
2. **Tentativa ≠ enviada:** os estados `awaiting_approval`, `approved`, `sending`, `send_failed`, `needs_human` e `expired` pertencem à Fase 4 (automação) e **não são criados agora** — ver Seção 5.6. Não haverá rota, coluna nem UI desse fluxo no Marco 1.
3. Nenhuma transição automática existe no Marco 1 (inclusive `rejected`: sem resposta, o status permanece).
4. Transições em lote são proibidas.

### 5.3 Independência entre status de vaga e de candidatura

- Mudar o status da vaga **nunca** altera o status da candidatura, e vice-versa: são máquinas separadas, em tabelas separadas, com transições validadas individualmente.
- Vaga `discarded` ou `closed` com candidatura em andamento: a candidatura permanece como está. A UI exibe um aviso ("Vaga encerrada — acompanhe a candidatura manualmente") e **sugere** sem aplicar qualquer mudança.
- Excluir a vaga exclui (soft delete) a candidatura junto, mas não altera nem apaga status algum.

### 5.4 Eventos gerados no histórico (`events`)

| `type`                                         | Quando                                | `from` → `to`           |
| ---------------------------------------------- | ------------------------------------- | ----------------------- |
| `job.created`                                  | criação da vaga                       | `null` → status inicial |
| `job.status_changed`                           | mudança de status válida              | anterior → novo         |
| `job.deleted`                                  | exclusão (soft delete)                | `null`                  |
| `job.restored`                                 | restauração                           | `null`                  |
| `application.created`                          | criação da candidatura                | `null` → `preparing`    |
| `application.status_changed`                   | mudança de status válida              | anterior → novo         |
| `application.deleted` / `application.restored` | exclusão/restauração                  | `null`                  |
| `note.added`                                   | criação de nota (vaga ou candidatura) | `null`                  |

Regras:

- **Edição de campos comuns** (empresa, descrição, localização…) **não** gera evento: o valor atual é a fonte de verdade. Histórico = ciclo de vida + notas.
- `actor` no Marco 1 é sempre `user` (a coluna aceita `system` para usos futuros; há CHECK no esquema).
- Eventos são imutáveis: sem UPDATE nem DELETE de `events`.
- Todo evento é gravado **na mesma transação** da mudança que o originou: ou tudo acontece, ou nada acontece.

### 5.5 Efeitos colaterais das transições (Marco 1)

| Mudança                    | Efeitos                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `preparing → sent`         | define `applied_at` (data informada ou agora) + evento `application.status_changed`               |
| `DELETE /jobs/:id`         | soft delete da vaga **e** da candidatura associada; eventos `job.deleted` + `application.deleted` |
| `DELETE /applications/:id` | soft delete só da candidatura; evento `application.deleted`                                       |
| `POST /jobs/:id/restore`   | restaura vaga + candidatura; eventos `job.restored` (+ `application.restored`)                    |
| `POST /jobs/:id/notes`     | evento `note.added`                                                                               |

### 5.6 Estados dos marcos futuros (referência — não implementar agora)

A Fase 4 acrescentará a `applications`: `awaiting_approval`, `approved`, `sending`, `send_failed`, `needs_human`, `expired`, além da tabela `send_attempts`. Invariantes **já definidos** e que devem ser preservados:

1. `sending → sent` exige `send_attempts.status='confirmed'` com `evidence_json` não nulo (recibo, número de candidatura, e-mail de confirmação). Sem evidência → `send_failed` ou `needs_human`.
2. **`attempted` ≠ `sent`.** `sending` é transitório e sempre termina em `sent`, `send_failed` ou `needs_human` (timeout `SENDING_TIMEOUT_MS`, default 10 min).
3. Falha de rede/timeout **nunca** vira `sent`.
4. Candidatura sem resposta **nunca** vira `rejected` automaticamente.
5. CAPTCHA, autenticação e demais barreiras → `needs_human` + intervenção humana; **nunca** contornadas.

## 6. Interface de conector de fonte — **Fase 2 (não implementar no Marco 1)**

> **Marco 1:** as vagas são cadastradas **manualmente**. Não existirá busca automática, busca manual, `/runs`, `/sources` nem conector algum até que uma fonte seja verificada quanto a disponibilidade, viabilidade técnica e condições de uso (registro obrigatório em `docs/FONTES.md`). A especificação abaixo permanece como base para a Fase 2.

### 6.1 Contrato

```ts
// backend/src/connectors/types.ts
export interface ConnectorContext {
  runId: number;
  signal: AbortSignal; // cancelamento/cooldown
  logger: RunLogger; // escreve em execution_logs
  config: SourceConfig; // limites, queries, timeout
}

export interface RawJob {
  externalId?: string;
  sourceUrl: string; // obrigatório e deve ser a URL canônica
  title: string;
  company?: string;
  location?: string;
  workMode?: "remote" | "hybrid" | "onsite" | "unknown";
  contractType?: "internship" | "junior" | "mid" | "senior" | "freelance" | "unknown";
  salaryText?: string;
  descriptionText: string; // texto puro, para dedupe e IA
  postedAt?: string; // ISO
  raw: unknown; // payload cru
}

export interface SourceConnector {
  readonly key: string; // 'remotive'
  readonly name: string;
  readonly kind: "api" | "html" | "browser";
  /** Estado declarado após verificação documentada em docs/FONTES.md. */
  readonly supportState: "unverified" | "verified" | "broken" | "blocked";
  /** Timeout específico da fonte; ausente = timeout padrão da coleta (30 s). */
  readonly timeoutMs?: number;
  /** Deve verificar e declarar suporte; lança SourceError('unsupported') se não viável */
  verify(): Promise<{ ok: boolean; reason?: string }>;
  fetch(ctx: ConnectorContext): AsyncIterable<RawJob>;
}

export class SourceError extends Error {
  constructor(
    public code:
      "unsupported" | "rate_limited" | "blocked" | "parse_error" | "network" | "captcha_required",
    message: string,
  ) {
    super(message);
  }
}
```

### 6.2 Normalização e deduplicação

Pipeline em `collect/` por vaga extraída:

1. **Normalizar texto:** trim, colapsar espaços/HTML, lowercase só para comparação (não para persistir), remover acentos na chave.
2. **Montar `dedupe_key`** (ordem de precedência):
   1. `source + external_id` quando a fonte tiver id estável;
   2. `hash(normalize(company) + '|' + normalize(title) + '|' + normalize(location))`;
   3. fallback: `hash(normalize(title) + '|' + normalize(company))`.
3. **`ON CONFLICT(dedupe_key) DO UPDATE`** dentro de transação:
   - atualiza `last_seen_at`, `fingerprint` (hash de title+description+location+salary);
   - se o fingerprint mudou, grava `payload_json` novo e cria `event(job.updated)`;
   - **nunca** reseta `jobs.status`, `applications` ou `priority`.
4. **Duplicata entre fontes:** mesmo `dedupe_key` → conta como `duplicate_count` no `search_runs` e vincula a fonte secundária em `payload_json.altSources[]`.
5. **Deduplicação de candidatura:** aplicação duplicada é impedida por `jobs.application_id UNIQUE` + lock de envio (Seção 9.3).

### 6.3 Fontes candidatas (NÃO assumir suporte antes de verificar)

Priorizar **APIs públicas e estáveis** antes de scraping. Verificar cada uma em `docs/FONTES.md` com data, resultado e evidência:

| Fonte                                               | Tipo         | Viabilidade preliminar | Observação                                                       |
| --------------------------------------------------- | ------------ | ---------------------- | ---------------------------------------------------------------- |
| Remotive API                                        | API          | alta                   | JSON público, sem auth; boa para remoto                          |
| RemoteOK API                                        | API          | alta                   | JSON público; respeitar rate limit                               |
| Nube                                                | API          | alta (Brasil)          | JSON público sem chave; estágios em Curitiba/remoto; empresa oculta |
| Arbeitnow API                                       | API          | média-alta             | JSON público                                                     |
| GitHub Issues (frontendbr/backend-br)               | API          | baixa                  | 0 estágio aberto em 2026-11-10; markdown livre                    |
| Hacker News (Who is hiring / Algolia HN API)        | API          | média                  | textinho; exige parse; bom para júnior                           |
| Careerjet / Adzuna / USAJobs                        | API          | média                  | exigem chave de API (custo/limite)                               |
| LinkedIn / Indeed / Glassdoor                       | HTML/Browser | **baixa / arriscada**  | ToS restritivos, CAPTCHA frequente; **não prometer suporte**     |
| RapidAPI (JSearch)                                  | API de terceiro | alta (validada)     | implementada na Fase 6.2; chave própria, cota de 200/mês; ToS pendente |
| Portais de ATS (Greenhouse, Lever, Ashby, Workable) | API/HTML     | média-alta             | têm endpoints públicos de vagas por empresa; bons para automação |

**Regra:** um conector só recebe `support_state='verified'` após (a) `verify()` ok, (b) uma execução real bem-sucedida, (c) registro em `docs/FONTES.md`. Portais de ATS entram na Fase 4 como alvo de automação, não de coleta em massa.

### 6.4 Políticas de coleta

- `User-Agent` identificável + identificação no README; `robots.txt` respeitado quando aplicável.
- Rate limit por fonte (mínimo 1 req/s, backoff exponencial em 429).
- Timeout por fonte (default 30 s; a fonte pode declarar `timeoutMs` próprio — a Nube usa 120 s por causa da paginação e o JSearch 45 s por causa das duas consultas); falha em uma fonte **não** aborta as demais → `search_runs.status='partial'`.
- Cache de página/JSON por 15 min para evitar rebuscas repetidas.
- Nenhuma fonte pode gerar mais de `MAX_JOBS_PER_RUN` (default 200) vagas por execução.

## 7. Agendamento, execução perdida e concorrência

### 7.1 Disparo diário às 18:00 (horário local)

**Agendador do Windows (Task Scheduler)** chama o CLI:

```
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
```

A tarefa `JobPilot-DailySearch` deve ser criada com:

- `Trigger`: diário às 18:00, fuso local da máquina.
- `StartWhenAvailable = $true` (**executa se a máquina estiver dormindo/apagada no horário**, assim que ligar).
- `RunOnlyIfNetworkAvailable = $true`.
- `ExecutionTimeLimit = 2h`; `MultipleInstances = IgnoreNew` (não empilhar).
- `Settings.DisallowStartIfOnBatteries = $false` + `StopIfGoingOnBatteries = $false` (notebook).
- Ação: `node backend/dist/cli/run-job.js --job collect` com working directory = raiz do repositório.
- **Não rodar como admin** por padrão (Playwright não exige admin).

O CLI também faz uma **verificação de atraso**: ao iniciar, consulta `search_runs` e, se a última execução `scheduled` for de data anterior ao último horário-alvo previsto, executa mesmo assim (cobre o caso de o agendador ter sido ignorado manualmente). Registrar `meta.missedRun=true`.

### 7.2 Ordem de execução do CLI `run-job`

1. Adquirir lock global (`scheduler.locks` ou lock de arquivo `data/.lock` com PID + timestamp).
2. Se já houver lock válido (PID vivo e idade < 12h) → registrar `search_runs(status='skipped', summary='concurrent')` e sair com código 0.
3. Criar `search_runs(trigger='scheduled'|'manual')`.
4. Rodar por fonte, em paralelismo limitado (2), coletando `execution_logs`.
5. Normalizar + dedupe (transação única por lote).
6. Opcional: enfileirar análises de IA para as novas vagas (limitadas por `AI_DAILY_BUDGET`).
7. Rodar `reminders` (vencidos) e `automation` (se habilitado e dentro das regras).
8. Fechar `search_runs` com status e contadores; escrever `summary` legível.
9. Gravar `data/last-run.json` (para o dashboard não precisar consultar o banco).
10. Liberar lock; sair com código `0` (success/partial) ou `1` (failed).

### 7.3 Concorrência e bloqueios

| Conflito                             | Mecanismo                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Duas buscas ao mesmo tempo           | lock global de arquivo com PID; segunda instância sai como `skipped`                                                              |
| Busca + envio automático             | lock global compartilhado (mesmo lock); sequencial                                                                                |
| Envio duplicado da mesma candidatura | lock por `application_id` (tabela + `UPDATE ... WHERE status NOT IN ('sending')` atômico)                                         |
| Dois cliques de "enviar" na UI       | mesmo lock + checagem de `send_attempts` recente (janela de 24 h) na mesma transação                                              |
| Servidor reiniciado durante envio    | ao subir, candidaturas em `sending` com tentativa > `SENDING_TIMEOUT_MS` são reconciliadas para `needs_human` (nunca para `sent`) |
| SQLite concorrência                  | `busy_timeout=5000`, WAL, transações curtas; escrita serializada                                                                  |

### 7.4 Sem servidor ligado

- O CLI roda **sem** o servidor da API ativo (acessa o SQLite diretamente).
- O dashboard exibe a última execução lendo `search_runs` + `data/last-run.json`.
- Recomendação (Seção 14): tarefa extra opcional a cada 15 min para garantir que o dashboard mostre alertas quando o app está aberto.

## 8. Limites da IA, prompts e schemas de saída

### 8.1 Fronteiras inegociáveis

1. **A IA nunca escreve no banco diretamente.** Ela retorna JSON validado por zod; a camada de domínio decide o que persistir.
2. **A IA não inventa qualificações.** Todo campo do `profile` que ela preencher deve vir do texto do CV (`raw_cv_text`) ou de preferência declarada pelo usuário. Cada item extraído carrega `source: 'cv' | 'user' | 'inferred'`; itens `inferred` precisam de confirmação na UI antes de virarem dados oficiais.
3. **A IA não decide status.** Ela sugere `score`, `rationale`, `gaps` e, no máximo, uma recomendação `recommend_apply: boolean` que o usuário confirma.
4. **Prompt injection:** a descrição da vaga é entrada não confiável. Ela vai sempre num bloco delimitado `<<<JOB_DESCRIPTION ... >>>` com instrução explícita de ignorar qualquer comando contido ali. Nenhum tool/ação é disparada a partir de texto de vaga.
5. **Custo sob controle:** contagem de tokens por chamada em `ai_analyses`; teto diário (`AI_DAILY_BUDGET`) que, ao ser atingido, pula a fila e registra `execution_logs(level='warn')`.
6. **Reprodutibilidade:** `model`, `prompt_version`, `temperature` e `raw_json` guardados para auditoria.
7. **Falha da IA não bloqueia o produto:** sem IA, o dashboard funciona; a análise fica `pending` e pode ser reprocessada.

### 8.2 Análise de compatibilidade — entrada

```jsonc
{
  "profile": {/* extracted_json + preferences_json, revisados */},
  "job": {
    "title": "...",
    "company": "...",
    "description": "...",
    "contractType": "...",
    "location": "...",
    "workMode": "...",
  },
  "instructions": "Responda em português. Não invente informações.",
}
```

### 8.3 Análise de compatibilidade — saída (zod)

```jsonc
{
  "score": 72, // inteiro 0..100
  "summary": "string (máx 500 chars)",
  "rationale": [
    // 3..6 itens, cada um referenciando evidência do CV ou da vaga
    { "point": "string", "evidence": "cv|job", "quote": "trecho curto" },
  ],
  "requirements": [
    { "text": "string", "kind": "required|nice_to_have", "match": "matched|missing|unknown" },
  ],
  "gaps": [{ "text": "string", "severity": "blocker|minor" }],
  "unknowns": ["string"], // informações que faltam na vaga ou no perfil
  "recommend_apply": true, // sugestão, não ordem
  "confidence": "low|medium|high",
}
```

Validação: falha de schema → nova tentativa (máx 2) → grava `execution_logs(error)` e deixa a análise como pendente, sem inventar conteúdo.

### 8.4 Extração de CV — saída (zod)

```jsonc
{
  "experiences": [
    {
      "role": "",
      "company": "",
      "start": "YYYY-MM",
      "end": "YYYY-MM|null",
      "highlights": [""],
      "source_quote": "",
    },
  ],
  "education": [{ "degree": "", "institution": "", "year": "", "source_quote": "" }],
  "skills": [{ "name": "", "level": "beginner|intermediate|advanced|null", "source_quote": "" }],
  "languages": [{ "name": "", "level": "", "source_quote": "" }],
  "projects": [{ "name": "", "url": "", "description": "", "source_quote": "" }],
  "inferred": [{ "field": "", "value": "", "reason": "" }], // exige confirmação do usuário
}
```

`source_quote` obrigatório em tudo que vem do CV: sem citação, o item é descartado.

### 8.5 Respostas de formulário e rascunho de candidatura (Fase 4)

- Implementado na fatia 3 como **rascunho assistido**: a IA redige a carta e as respostas a partir do perfil revisado, da vaga e das perguntas que a pessoa informar.
- Saída: `{ cover_letter: [{text, evidence}], answers: [{question, answer, evidence}], warnings }`, com `evidence` no formato `{source: "cv" | "job", quote}`.
- Toda citação é verificada literalmente contra o conteúdo enviado ao modelo; trechos sem citação comprovável são descartados e viram aviso.
- O rascunho **não** é salvo como candidatura, **não** é enviado e **não** altera status: a pessoa revisa, edita e copia.
- Regra mantida: nunca preencher informação ausente no perfil (anos de experiência, salário, autorização etc.). O modelo deve usar `warnings` em vez de afirmar o que não está comprovado.
- O rascunho consome o teto diário de IA com o tipo `draft`.

### 8.6 Prompt engineering

- Prompts em módulos versionados (`src/ai/prompts.ts`) com constante de versão.
- Instruções de sistema fixas: papel, idioma (pt-BR), formato JSON estrito, "não invente", "responda null quando não souber".
- `temperature` baixo (0–0.3) para extração/análise; mais alto só para redação.
- Retry com backoff; timeout 60 s; nunca re-tentar sem limite.

## 9. Autorização e segurança da automação — **Fase 4 (não implementar no Marco 1)**

> Nenhuma parte desta seção é implementada agora. As regras abaixo são **contrato para o marco futuro** e devem ser preservadas tal como estão.
>
> **Atualização de 2026-11-08:** a Fase 4 adotou **candidatura assistida** (sem
> envio automático), porque Gupy, LinkedIn, Indeed e Glassdoor vedam automação.
> Esta seção só volta a valer se um portal com condições de uso compatíveis e
> programa oficial para candidatos for escolhido e verificado.

### 9.1 Modelo de autorização em camadas

Uma candidatura só pode ser enviada automaticamente se **todas** as camadas abaixo passarem. Cada camada registra o motivo de bloqueio em `send_attempts.error_code` e exibe no dashboard.

```
Camada 1 — Chave mestra:  automation.enabled == true (config global, desligado por padrão)
Camada 2 — Regra:         automation_rules.enabled == true
Camada 3 — Elegibilidade: score ≥ min_score, contrato na lista, fonte/portal na lista,
                          empresa não bloqueada, vaga aberta, sem candidatura duplicada
Camada 4 — Portal:        portals.support_state == 'verified'
Camada 5 — Credencial:    existe credencial válida ou portal não exige login
Camada 6 — Limite:        envios hoje < max_sends_per_day (e < limite global diário)
Camada 7 — Confirmação:   se requires_confirm == 1 → aguarda clique do usuário (estado 'approved')
Camada 8 — Execução:      Playwright em portal suportado, sem contornar proteções
```

### 9.2 Regras de segurança obrigatórias

1. **Desligado por padrão.** `automation.enabled=false` em instalação nova; a UI exibe banner claro quando ligado.
2. **Nunca contornar proteções:** sem solver de CAPTCHA, sem evasão de fingerprint, sem automação para burlar ToS. CAPTCHA/2FA/login expirado → `needs_human` + lembrete. Zero tentativas de "resolver".
3. **Só portais `verified`:** registro em `docs/FONTES.md` com data, fluxo testado e evidência. Enquanto `unverified`/`blocked`, a automação é recusada na Camada 4.
4. **Sem inventar qualificações:** campos só recebem dados do perfil revisado; campo não respondido → bloqueio, nunca preenchimento fabricado.
5. **Prevenção de duplicado:**
   - lock por candidatura durante toda a execução;
   - checagem de `send_attempts` nas últimas 24 h antes de iniciar;
   - checagem de candidatura pré-existente no portal (quando o portal expõe "applied") antes do envio;
   - se o envio for interrompido após o clique, o padrão é `needs_human`, nunca re-tentativa automática.
6. **Limites rígidos:** `max_sends_per_day` por regra (default 5), limite global diário (default 10), cooldown mínimo de 60 s entre envios, janela de execução (ex.: 09:00–20:00).
7. **Pausa de emergência:** botão "Parar automação" que desliga a chave mestra e interrompe execução em andamento no próximo checkpoint seguro (nunca mata um envio já confirmado no portal).
8. **Auditoria completa:** cada passo em `send_attempts.steps_json` com timestamp; evidência de confirmação em `evidence_json`.
9. **Verdade no status:** em automação, só `sent` com evidência. Sem evidência → `send_failed`/`needs_human`. A UI distingue explicitamente "Tentado" de "Confirmado enviado". (No Marco 1 não há automação: `sent` é declaração manual do usuário, sempre com `applied_at` e evento registrados — nunca inferido pelo sistema.)
10. **Credenciais cifradas** (`AES-256-GCM` com `ENCRYPTION_KEY` do `.env`), em `credentials`, nunca em logs nem em `payload_json`. **Não existem no Marco 1** (nenhuma tabela de credenciais é criada agora). A Fase 4 deve documentar, antes de guardar qualquer credencial: geração da chave, onde ela fica, como perdê-la/como recuperá-la, e que **a perda da chave inviabiliza a descriptografia** (backup da chave fora do backup do banco).
11. **Confirmação por candidatura é o padrão.** `requires_confirm=1` por omissão em qualquer regra nova. Envio sem confirmação só é possível mediante autorização explícita do usuário configurando regra, limites e portais permitidos — e essa configuração é sempre visível e editável.
12. **A confirmação nunca é removida automaticamente.** Passar um período usando a automação **não** desativa `requires_confirm`. Só o usuário pode mudar essa configuração, de forma deliberada.

### 9.3 Máquina de uma tentativa de envio

```
approved ─▶ prepared ─▶ attempted ─┬─▶ confirmed   (evidência gravada → application.status = sent)
                                   ├─▶ failed      (erro recuperável → application = send_failed)
                                   ├─▶ blocked     (regra/camada recusou → application permanece)
                                   └─▶ needs_human (CAPTCHA/auth/formulário não suportado)
```

Regras:

- `confirmed` exige `evidence_json` não vazio — invariant verificado no domínio, não no conector.
- `steps_json` é append-only.
- Re-tentativa nova cria **novo** `send_attempts`; a tentativa antiga nunca é sobrescrita.

### 9.4 Portais — expectativa realista

| Portal                     | Coleta                     | Automação                          | Situação    |
| -------------------------- | -------------------------- | ---------------------------------- | ----------- |
| Greenhouse                 | sim (API pública de vagas) | plausível (formulário padronizado) | a verificar |
| Lever                      | sim (API pública)          | plausível                          | a verificar |
| Ashby                      | sim                        | plausível                          | a verificar |
| Workable / SmartRecruiters | parcial                    | incerto                            | a verificar |
| LinkedIn / Indeed          | arriscada                  | **não prometer**                   | CAPTCHA/ToS |
| Careers page próprio       | caso a caso                | caso a caso                        | a verificar |

**Regra de comunicação:** a UI usa os termos "Suportado (verificado em DD/MM/AAAA)", "Em avaliação" e "Não suportado". Nunca "compatível" sem verificação.

## 10. Logging, backup, configuração e tratamento de erros

### 10.1 Logging (Marco 1)

- **Destinos:** console (terminal) + arquivo `data/logs/app-YYYY-MM-DD.log`.
- Implementação própria e pequena (`backend/src/logging/logger.ts`): níveis `debug|info|warn|error`, timestamp ISO, mensagem e `meta` serializada. Sem dependência externa de logging no Marco 1.
- **Segredos nunca em log.** Mascaramento em `logger.ts` para chaves `password`, `token`, `apiKey`, `authorization`.
- Poda simples: na inicialização, apagar arquivos de log com mais de 30 dias.
- Erros de requisição sempre chegam ao console com `method`, `path`, `status` e `code`.
- A partir da Fase 2 passa a existir também `execution_logs` no banco (consultável na UI de Execuções); **não existe no Marco 1**.

### 10.2 Backup e restauração — **implementado no Marco 1**

- **Backup:** cópia consistente do banco via `VACUUM INTO` (SQLite ≥ 3.27) para `data/backups/jobpilot-YYYYMMDD-HHMMSS-HHmmssSSS.sqlite` — **nunca** copiar o arquivo com o WAL aberto.
- O arquivo é validado antes de ser considerado pronto: `PRAGMA integrity_check` = `ok` e presença das tabelas do esquema. Só então é gravado na tabela `backups`.
- Endpoints: `POST /backups` (cria), `GET /backups` (lista com data/tamanho). Comando de linha: `npm run backup` no backend.
- **Restauração (`POST /restore`):**
  1. exige confirmação explícita (`{ "fileName": "...", "confirm": true }`);
  2. valida o arquivo candidato (`integrity_check` + tabelas esperadas) **antes** de mexer no banco atual;
  3. cria um backup automático do estado atual (`kind='pre_restore'`);
  4. bloqueia outras escritas durante a operação (responde `503` em paralelo);
  5. fecha o banco com `wal_checkpoint(TRUNCATE)`, substitui o arquivo e reabre;
  6. revalida (`integrity_check` + `foreign_key_check` + contagens);
  7. se a revalidação falhar, **restaura automaticamente** o backup `pre_restore` e informa o erro;
  8. registra tudo em `backups` e nos logs.
- **Segredos fora do backup:** o backup contém apenas o banco (nenhuma chave está dentro dele, pois o Marco 1 não guarda credenciais). Chaves de `.env` **nunca** entram em backup algum — backup de `.env` é responsabilidade explícita do usuário, fora do repositório (documentar em `docs/BACKUP-RESTORE.md`).
- **Marcos futuros:** antes de existir tabela `credentials`, documentar geração, guarda e recuperação da `ENCRYPTION_KEY` (perda da chave = perda irrecuperável dos dados cifrados) e decidir se ela é incluída em algum backup protegido.
- Retenção: manter os últimos 14 backups; excedentes são apagados com aviso em log.
- `.gitignore` deve conter: `data/`, `.env`, `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`, `node_modules/`, `dist/`.

### 10.3 Configuração

| Camada             | Arquivo/tabela                        | Conteúdo                                    | Versionado?                    |
| ------------------ | ------------------------------------- | ------------------------------------------- | ------------------------------ |
| Ambiente           | `.env` (só `.env.example` versionado) | `PORT`, `HOST`, `DATABASE_PATH`, `DATA_DIR`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_TIMEOUT_MS` | não |
| Padrões do app     | `backend/src/config/index.ts`        | valores default de tudo (validados com zod)  | sim                            |
| Ajustes do usuário | tabela `settings`                     | `display_name`, `timezone`                  | fica no banco (não versionado) |
| Estado operacional | `data/`                               | banco, logs, backups                        | não                            |

- Sem segredos obrigatórios: a aplicação roda **sem `.env`** (todos os valores têm default).
- O backend lê `.env` da raiz do repositório quando `loadConfig()` é chamado sem `env` explícito; **`process.env` tem precedência** sobre o arquivo. Os testes passam `env` explícito e ignoram o `.env` do desenvolvedor de propósito.
- Único segredo da Fase 2: `AI_API_KEY` (opcional). Sem ela, `config.ai` é `null` e **só** a extração assistida fica indisponível.
- Validação na carga com zod; config inválida → falha clara no startup indicando a chave.
- `HOST` tem default `127.0.0.1`: **o servidor não escuta na rede local por padrão**.

### 10.4 Tratamento de erros

- **Taxonomia:** `VALIDATION | NOT_FOUND | CONFLICT | SOURCE | AI | PORTAL | NETWORK | INTERNAL`.
- Erro de domínio → classe `AppError(code, httpStatus, message, details)`; handler central devolve o envelope padrão e grava `execution_logs` quando em execução.
- **Isolamento por fonte:** falha em `remotive` não derruba a execução; vira `partial` + `error_count`.
- **Timeouts e retries:** idempotência por operação; retry exponencial com jitter, máx 3 tentativas; `AbortSignal` propagado em toda a cadeia (cancelamento limpo).
- **Reconciliação ao iniciar:** estados transitórios órfãos (`sending`, `analyzing`, `running`) com timeout são resolvidos para um estado seguro (nunca para `sent`).
- **Erros não tratados:** `unhandledRejection`/`uncaughtException` → log crítico, flush de logs, saída com código 1; o lock é liberado.
- **Feedback na UI:** toda ação assíncrona retorna `runId`/`taskId`; a UI acompanha por polling (3 s) até concluir, e exibe o resumo + link para os logs.

## 11. Estratégia de testes

| Nível              | Ferramenta                           | Alvo                                                                              | Marco   | Cobertura mínima                     |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------------------- | ------- | ------------------------------------ |
| Unitário           | Vitest                               | `domain/statuses.ts` (máquinas de estado), regras de exclusão/restauração, config | **M1**  | 90% de statements no domínio         |
| Integração         | Vitest + SQLite temporário           | migrações, repositórios, transações, API HTTP                                     | **M1**  | todos os endpoints do Marco 1        |
| Backup/restore     | Vitest                               | criação, validação de integridade, restauração com rollback                       | **M1**  | fluxo completo                       |
| Contrato de schema | Vitest                               | schemas zod de saída da IA (fixtures boas e ruins)                                | Fase 3  | 100% dos schemas                     |
| Coleta             | Vitest + fixtures HTML/JSON gravadas | normalização, dedupe, falha parcial de fonte                                      | Fase 2  | todos os conectores                  |
| E2E de UI          | Playwright                           | fluxos do dashboard                                                               | Fase 2+ | criar/editar vaga, status, histórico |
| Automação de envio | Playwright + mock de portal          | `send_attempts`, bloqueios, CAPTCHA→needs_human, duplicado                        | Fase 4  | camadas 1 a 8                        |
| Agendamento        | Vitest                               | lock, missed-run, reconciliação de `sending`                                      | Fase 2  | cenários de concorrência             |

Regras (válidas desde o Marco 1):

- **Sem rede em testes:** tudo roda offline com dados temporários (banco em diretório temporário, um teste por arquivo).
- `npm test` deve passar offline em qualquer máquina limpa.
- Testes de API sempre usam banco temporário próprio e único por arquivo de teste (nunca o banco real do usuário).
- A partir da Fase 2: fontes usam fixtures; a IA usa `FakeAiProvider` com respostas pré-gravadas; automação usa portal mockado.
- Critérios de cobertura agregados: ≥ 80% global no backend; domínio ≥ 90%.
- Checklist manual documentado para a verificação real de cada fonte/portal (Seção 6.3 / 9.4).

## 12. Fases, tarefas e critérios de aceitação

> Critérios de aceitação (CA) são verificáveis por agente de código: executar, observar e registrar evidência. Código gerado sem CA atendido não conta como entrega.

### Marco 1 — Fundação, dados e dashboard (escopo fechado, ver 13.1)

**Inclui:** monorepo e configuração dos ambientes; SQLite local + migrações versionadas; CRUD de vagas (criar, listar, ver, editar, excluir/restaurar); candidaturas (criar, editar, acompanhar status); status explícitos de vaga e candidatura validados no backend; histórico de eventos; notas (criação e edição); dashboard com contadores e atividade recente; configurações locais essenciais; backup/restauração com validação de integridade; testes automatizados; UI em pt-BR.

**Exclui (não implementar, não simular):** IA; coleta/busca automática ou manual; conectores de fontes; agendamento; Playwright; automação de envio de candidaturas; upload de currículo; lembretes/notificações; qualquer rota decorativa sem ação real.

| #     | Tarefa                                                                               | CA                                                                                                 |
| ----- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| M1.1  | Monorepo com workspaces, TS estrito, lint/format, `.gitignore` correto               | `npm install && npm run build && npm test` passam; nenhum segredo no git                           |
| M1.2  | Migrações SQL versionadas + runner                                                   | `npm run db:migrate` cria as tabelas da Seção 3.2; `integrity_check` ok; re-execução é idempotente |
| M1.3  | Camada de config com validação                                                       | app inicia **sem** `.env`; `HOST=127.0.0.1` por padrão                                             |
| M1.4  | Servidor HTTP + envelope de erro + validação de entrada                              | testes de integração dos endpoints de sistema passam; rotas inexistentes → 404 com envelope        |
| M1.5  | Máquinas de status + eventos na mesma transição                                      | transição inválida → 409; toda mudança de status gera `event` com `from`/`to`                      |
| M1.6  | CRUD de vagas (incl. soft delete e restore)                                          | criar/editar/excluir/restaurar; histórico preservado; listagem filtra excluídas por padrão         |
| M1.7  | Candidaturas 1:1 com status próprio                                                  | `POST /jobs/:id/application` → `preparing`; `409` se duplicada; status da vaga nunca muda sozinho  |
| M1.8  | Notas em vaga/candidatura (criar, editar, excluir)                                   | evento `note.added`; nota editada mantém `updated_at`                                              |
| M1.9  | Dashboard com contadores reais + atividade recente                                   | contadores batem com o banco em teste de integração                                                |
| M1.10 | Configurações locais (`display_name`, `timezone`)                                    | `GET/PUT /settings`; valores refletidos na UI                                                      |
| M1.11 | Backup e restauração validados                                                       | backup passa em `integrity_check`; restore recupera dados e faz rollback automático em falha       |
| M1.12 | UI React (dashboard, vagas, detalhe, candidaturas, histórico, notas, backup, config) | UI consome a API real; nenhum botão sem ação; sem dados falsos                                     |
| M1.13 | Testes unitários + integração (offline)                                              | `npm test` verde offline em máquina limpa                                                          |

### Fase 2 — Coleta automática

**Etapa 1 concluída — cadastro assistido por IA:** rotas `/extractions/status|from-text|from-url`, provedor `AiProvider` (compatível OpenAI), prévia editável em `/vagas/nova` com confirmação humana, detecção de duplicatas na prévia, `jobs.posted_at` (migração 002) e proteções de SSRF/URL. CA: extrair de texto → conferir → confirmar → vaga criada com evento; sem chave de IA, o restante segue funcionando.

**Etapa 2 concluída — coleta via CLI:** **dois conectores de API verificados** — Remotive (2.1) e Remote OK (2026-11-04, ver `docs/FONTES.md`) —, `npm run collect` com normalização + dedupe (2.2), isolamento de falha por fonte (2.3), lock de arquivo com execução `skipped` (2.4, sem missed-run ainda) e registro em `docs/FONTES.md` (2.7). CA: reexecutar → `new_count=0`; fonte quebrada → `partial` e as demais gravam; duas execuções simultâneas → uma `skipped`. O script `scripts/install-task.ps1` instala a tarefa diária das 18:00 (2.5) — a instalação é feita pelo usuário, e o PC precisa estar ligado.

**Etapa 3 concluída — página de Execuções:** `GET /runs` (histórico + `last-run.json`), `GET /runs/:id` (logs) e `GET /sources`; página `/execucoes` no menu com resumo da última coleta, fontes, histórico e logs. CA (2.6): o usuário vê horário, contagens, fontes e erros. Falta a verificação de missed-run (2.4).

| #   | Tarefa                                                        | CA                                                                                           |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 2.1 | Interface `SourceConnector` + 2 conectores de API verificados | `verify()` ok; execução real grava vagas com `source_url`                                    |
| 2.2 | Normalização + dedupe                                         | executar duas vezes seguidas → `new_count=0`, `duplicate_count` correto; sem perda de status |
| 2.3 | Falha parcial por fonte                                       | fonte quebrada → `status='partial'`, demais fontes gravam                                    |
| 2.4 | CLI `run-job` + lock + missed-run                             | duas execuções simultâneas → uma `skipped`; rodar no dia seguinte após PC apagado → executa  |
| 2.5 | Tarefa do Windows às 18:00 (`install-task.ps1`)               | tarefa criada, `StartWhenAvailable` ok, execução registrada em `search_runs`                 |
| 2.6 | Página de Execuções com logs                                  | usuário vê horário, contagens, fontes e erros                                                |
| 2.7 | Registro em `docs/FONTES.md`                                  | cada fonte com estado, data e evidência                                                      |

### Fase 3 — IA e priorização

| #   | Tarefa                                         | CA                                                                         |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| 3.1 | Adapter de IA + `FakeAiProvider` + schemas zod | fixtures válidas passam; inválidas disparam retry e depois erro registrado |
| 3.2 | Extração de CV com citações e confirmação      | item sem `source_quote` é descartado; `inferred` exige confirmação         |
| 3.3 | Análise de compatibilidade + histórico         | score e justificativas no detalhe da vaga; re-análise não apaga a anterior |
| 3.4 | Limites de custo e orçamento diário            | ao atingir o teto, fila pausa com aviso; uso visível na UI                 |
| 3.5 | Prioridade derivada + ordenação no dashboard   | ordenar por prioridade; prioridade manual prevalece                        |
| 3.6 | Teste de prompt injection                      | descrição com instrução hostil não gera ação nem vaza dados                |

### Fase 4 — Candidatura assistida

> Substitui a antiga “automação controlada” após a verificação dos termos de uso
> dos portais-alvo. Nenhum envio é feito pelo JobPilot.

| #   | Tarefa                                        | CA                                                                     |
| --- | --------------------------------------------- | ---------------------------------------------------------------------- |
| 4.1 | Kit de candidatura + detecção de portal       | portal e checklist visíveis; kit é somente leitura e não consome IA    |
| 4.2 | Envio declarado + evidência                   | confirmar cria/avança a candidatura para `sent` com data; sem duplicata |
| 4.3 | Respostas sugeridas por IA (opcional)         | rascunho com citação literal verificada e revisão humana; nada é enviado nem salvo como candidatura |
| 4.4 | Portais e segurança                           | `docs/PORTAIS.md`; nenhum login, CAPTCHA ou scraping desses portais    |
| 4.5 | Revisão de segurança e regressão              | sem segredos; kit não gasta IA; ToS reverificados antes de mudanças    |

### Fase 5 — Acompanhamento e consolidação

| #   | Tarefa                                          | CA                                                 |
| --- | ----------------------------------------------- | -------------------------------------------------- |
| 5.1 ✅ | Lembretes + painel de pendências                | follow-up vencido aparece em destaque              |
| 5.2 ✅ | Canal de notificação escolhido (Seção 14)       | lembrete chega no canal; falha gera log, não crash |
| 5.3 ✅ | Histórico consolidado e exportação              | exportar CSV/JSON de vagas, candidaturas e eventos |
| 5.4 ✅ | Revisão de segurança e regressão                | checklist completo; sem segredos; restore testado  |
| 5.5 ✅ | Documentação (instalação, uso, backup, portais) | usuário novo instala seguindo só o README          |

### Fase 6 — Fontes brasileiras e cobertura local

> Objetivo: fazer o JobPilot **procurar vagas sozinho**, de graça, cobrindo estágios em Curitiba
> (presencial/híbrido) e remotos. Nenhuma fonte desta fase faz login, resolve CAPTCHA ou envia
> candidatura; o link abre a página original para o envio humano.

| #      | Tarefa                                      | CA                                                                                                 |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 6.1 ✅ | Conector Nube                               | `verify()`/`fetch()` reais; 39 vagas no recorte em 2026-11-10; 16 testes offline; `docs/FONTES.md` |
| 6.2 ✅ | Conector JSearch (RapidAPI)                 | `/search-v2` com cache e duas consultas; execução real em 2026-11-13: 4/4 fontes ok, 19 estágios (9 Curitiba, 10 remotos); 16 testes offline; cota 200/mês documentada |
| 6.3    | Adzuna / Jooble                             | chaves gratuitas criadas pelo usuário; cobertura BR/Curitiba medida e registrada antes do código   |
| 6.4    | GitHub Issues                               | verificado em 2026-11-10: 0 estágio aberto; não implementar enquanto o volume for irrelevante      |
| 6.5 ✅ | Filtro por área na coleta                   | `search_preferences.area_keywords` (migração 011) editável em Configurações; título aceita qualquer palavra-chave, descrição só tecnologias específicas; lista vazia = sem filtro; 16 testes unitários + integração de coleta/API |

## 13. Ordem de implementação recomendada e primeiro marco

### Ordem

1. **Fase 1 completa** (fundação → dashboard funcional com dados manuais).
2. **Fase 2** (coleta + agendamento) — é o que passa a alimentar o dashboard automaticamente.
3. **Fase 3** (IA) — depende de fontes estáveis para ter o que analisar.
4. **Fase 4** (automação) — só após Fase 3 e após o portal-alvo ser verificado.
5. **Fase 5** (lembretes e consolidação) — pode ter itens paralelos desde a Fase 2 (ex.: exportação).

Dentro de cada fase, ordem: **dados → domínio → API → UI → testes → documentação**. Nunca UI sem contrato de API.

### Marco 1 — escopo fechado

**"Dashboard com vagas e candidaturas manuais, status validados e histórico — 100% local, sem IA, sem coleta e sem automação."**

**Inclui:**

1. Estrutura do monorepo e configuração dos ambientes de frontend e backend.
2. Banco SQLite local e sistema de migrações versionadas.
3. Cadastro, listagem, visualização, edição e exclusão (soft delete + restauração) de vagas.
4. Cadastro e acompanhamento de candidaturas (1:1 com a vaga).
5. Controle explícito dos status de vagas e de candidaturas, com transições validadas no backend.
6. Histórico de eventos das vagas e das candidaturas.
7. Inclusão e edição de notas (vinculadas à vaga ou à candidatura).
8. Dashboard com contadores reais e atividade recente.
9. Configurações locais essenciais (`display_name`, `timezone`).
10. Testes automatizados (domínio, API, persistência, backup/restore).
11. Backup e restauração do banco, com validação de integridade e rollback.

**Não inclui (não implementar, não simular, não criar rota decorativa):**

- Inteligência artificial.
- Coleta automática (ou manual) de vagas — **no Marco 1 as vagas são cadastradas pelo usuário**.
- Conectores de plataformas/fontes.
- Agendamento de pesquisas (nada de `/runs`, `/sources`, Task Scheduler).
- Playwright e qualquer automação de candidaturas.
- Envio automático de candidaturas (não existem `send_attempts`, regras nem credenciais).
- Upload e processamento de currículo.
- Lembretes e notificações.

**Aceitação do Marco 1:** instalar → migrar → iniciar → criar 3 vagas na UI → editar campos → mudar status de 2 (com transição inválida recusada) → criar 2 candidaturas e avançar 1 até `sent` com data → adicionar/editar notas → conferir contadores e atividade no dashboard → `npm test` verde → gerar backup → restaurar e validar → confirmar que os dados reais voltaram.

## 14. Decisões

### 14.1 Resolvidas para o Marco 1 (registro de decisão)

| #   | Decisão           | Escolha                                                                                                                                                                                        |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Acesso a dados    | `node:sqlite` (módulo nativo do Node ≥ 22.5) + SQL explícito + migrações em arquivos `.sql`. **Sem ORM** no Marco 1: menos dependência e mesmo controle. Se a complexidade crescer, reavaliar. |
| R2  | HTTP              | Express + validação de entrada/saída com `zod`. Servidor escuta **somente em `127.0.0.1`**.                                                                                                    |
| R3  | Exclusão          | Soft delete (`deleted_at`) em vagas, candidaturas e notas; histórico nunca é destruído.                                                                                                        |
| R4  | Prioridade        | Sem coluna de prioridade numérica no Marco 1 (o status `prioritized` basta).                                                                                                                   |
| R5  | `sent` no Marco 1 | É **declaração manual** do usuário com `applied_at`; a automação (com exigência de evidência) vem só na Fase 4.                                                                                |
| R6  | Frontend          | Vite + React + TS, roteamento simples, cliente HTTP próprio (fetch) e CSS próprio — sem framework de estado ou de estilo.                                                                      |
| R7  | Testes            | Vitest + supertest, banco temporário por teste, 100% offline.                                                                                                                                  |
| R8  | Logs              | Logger próprio (console + arquivo diário em `data/logs/`), sem dependência externa.                                                                                                            |
| R9  | Idioma            | UI, mensagens e documentação em **pt-BR**.                                                                                                                                                     |
| R10 | Provedor de IA (Fase 2) | Provedor único e pequeno, com interface `AiProvider` e implementação **compatível com a API da OpenAI** (`/chat/completions`, saída JSON estruturada). Funciona com OpenAI, OpenRouter, Groq, DeepSeek ou endpoint local (Ollama/vLLM) trocando `AI_BASE_URL`/`AI_MODEL`. Sem arquitetura de plugins: uma abstração basta. |
| R11 | Confirmação humana | A extração **nunca** grava: devolve prévia e a gravação usa o `POST /jobs` existente só após o usuário confirmar.                                                                            |
| R12 | `posted_at` (migração 002) | Coluna `jobs.posted_at` (nullable) porque a data de publicação só pode vir da fonte; **nunca** é preenchida com a data atual. Compatível com dados existentes (ficam `NULL`).           |
| R13 | Conteúdo por URL   | HTTP simples (sem JS, sem Playwright), apenas `http/https`, validação de destino **antes** de cada salto de redirecionamento, limite de 5 saltos, 15 s, 2 MB e tipos `html/xhtml/plain`. Proteção de SSRF bloqueia loopback, privados, link-local, CGNAT e metadata. |
| R14 | Conteúdo não confiável | Texto da vaga vai ao modelo sempre entre delimitadores, com instrução explícita de ignorar comandos ali contidos (anti prompt injection); a IA não define id, status nem campos de controle. |
| R15 | Deduplicação na Fase 2 | Detecção **informativa** na prévia: URL normalizada (forte) + empresa+título normalizados (apenas indício). Nunca descarta sozinha — o usuário decide. `dedupe_key`/`ON CONFLICT` da Seção 6.2 ficam para a coleta em massa. |
| R16 | Coleta em massa (Fase 2) | Dedupe sem coluna `dedupe_key`: `source+external_id` → URL normalizada → empresa+título+localização. Localização ausente em um dos lados usa o fallback empresa+título; localizações **diferentes** não bloqueiam. A vaga existente nunca é alterada (`updated_count=0`): status, candidaturas e notas ficam intactos. Lock `data/.lock` (PID vivo + idade < 12 h) e falha parcial por fonte (`status='partial'`). |

### 14.2 Ainda dependem do usuário (blocos das fases futuras)

| #       | Decisão                                  | Opções                                                                                                                                          | Recomendação                                                                                                                                                                                                                                                             |
| ------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D1**  | **Fontes iniciais de vagas** (Fase 2/6)  | (a) só APIs públicas (Remotive, RemoteOK, Arbeitnow); (b) APIs + HN Algolia; (c) incluir ATS de empresa; (d) tentar LinkedIn/Indeed (arriscado) | **(a) + (b) + Nube** (2026-11-10); RapidAPI só com chave e validação explícita; LinkedIn/Indeed fora do escopo inicial                                                                                                                                                  |
| **D2**  | **Provedor de IA e orçamento** (Fase 3)  | OpenAI / Anthropic / Google / modelo local (Ollama) / outro                                                                                     | escolha + **teto mensal em USD** + se aceita envio do CV para terceiros                                                                                                                                                                                                  |
| **D3**  | **Canal de lembretes** (Fase 5)          | só no dashboard / e-mail local (SMTP) / desktop notification / Telegram bot                                                                     | **dashboard + notificação desktop**; e-mail depois                                                                                                                                                                                                                       |
| **D4**  | **Tratamento do arquivo do CV** (Fase 3) | (a) só texto extraído, arquivo apagado; (b) retido em `data/uploads/`; (c) retenção por N dias                                                  | **(b)** com backup incluído; confirmar aceitação                                                                                                                                                                                                                         |
| **D5**  | **Limites da automação** (Fase 4)        | envios/dia, janela de horário, portais permitidos, confirmação                                                                                  | **decisão de 2026-11-08: não há automação de envio.** Todos os portais-alvo são `manualOnly`; o JobPilot só prepara dados e registra o envio declarado. |
| **D6**  | **Portal-alvo da Fase 4**                | Gupy / LinkedIn (candidatura simplificada) / Indeed / Glassdoor / outro                                                                         | **Gupy, LinkedIn, Indeed e Glassdoor — candidatura assistida**. Os quatro vedam bots/automação (ver `docs/PORTAIS.md`); nenhum envio é feito pelo JobPilot. |
| **D7**  | **Auth do servidor**                     | só 127.0.0.1 / token `X-JobPilot-Token`                                                                                                         | Marco 1: **127.0.0.1** (R2); token só se expuser fora de localhost                                                                                                                                                                                                       |
| **D8**  | **Backup automático**                    | manual / semanal automático                                                                                                                     | Marco 1: **manual pela UI + CLI**; agendamento semanal na Fase 5 (`scripts/install-backup-task.ps1`)                                                                                                                                                                     |
| **D9**  | **Fuso e hora fixos**                    | fuso da máquina / fixar `America/Sao_Paulo`                                                                                                     | Marco 1: **configurável em Configurações**, default `America/Sao_Paulo`                                                                                                                                                                                                  |
| **D10** | **Escopo de contratos de interesse**     | estágio, júnior, ambos, também pleno/CLT remoto?                                                                                                | confirmar para calibrar filtros e futuras queries                                                                                                                                                                                                                        |
| **D11** | **Idioma da UI e dos dados**             | pt-BR / en                                                                                                                                      | **pt-BR** (adotado — ver R9)                                                                                                                                                                                                                                             |
| **D12** | **Marco 1**                              | iniciar agora?                                                                                                                                  | em execução                                                                                                                                                                                                                                                              |

---

_Especificação de projeto. O Marco 1 e a primeira etapa da Fase 2 (cadastro assistido por IA: Seções 4.6, 6.2 parcial, 10.3) estão implementados neste repositório; as demais partes das Seções 4.4–4.7, 6, 7, 8 e 9 e as Fases 2–5 descrevem trabalho futuro e não devem ser antecipados._
