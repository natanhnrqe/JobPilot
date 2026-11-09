-- Fase 5 (fatia 1) — lembretes de acompanhamento.
--
-- Um lembrete pertence a uma candidatura e nunca dispara nenhuma ação no
-- portal: ele só aparece no painel de pendências e no detalhe da candidatura
-- para o usuário decidir o próximo passo.
--
--   kind        follow_up | deadline | interview | custom
--   status      pending | done | dismissed
--   triggered_at momento em que o lembrete foi exibido/notificado (Fase 5.2)

CREATE TABLE reminders (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  due_at         TEXT NOT NULL,
  kind           TEXT NOT NULL
                 CHECK (kind IN ('follow_up','deadline','interview','custom')),
  message        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','done','dismissed')),
  triggered_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX ix_reminders_due ON reminders(status, due_at);
CREATE INDEX ix_reminders_app ON reminders(application_id, status);
