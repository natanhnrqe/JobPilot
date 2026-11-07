-- Fase 3 (fatia 2) — perfil profissional e importação de currículo.
--
-- Linha única (id = 1). O arquivo original do CV NÃO é armazenado: por
-- privacidade guardamos apenas o texto extraído em raw_cv_text e o resultado
-- estruturado revisado pelo usuário. cv_file_path permanece NULL.
--
-- extracted_json:   dados revisados do perfil:
--                   { personal, experiences, education, skills, languages,
--                     projects, inferred }
-- preferences_json: cargos, modalidades, localidades, pretensão e contratos.
-- answers_json:     respostas padrão para formulários de candidatura.
--
-- A IA nunca grava aqui diretamente: as rotas /profile/cv (prévia) e
-- /profile/cv/confirm (confirmação humana) são as únicas portas de entrada.

CREATE TABLE profile (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  version           INTEGER NOT NULL DEFAULT 1,
  raw_cv_text       TEXT,
  cv_file_path      TEXT,
  extracted_json    TEXT NOT NULL,
  preferences_json  TEXT NOT NULL,
  answers_json      TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
