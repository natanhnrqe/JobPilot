-- Fase 4 (fatia 2) — evidência da candidatura assistida.
--
-- O JobPilot não envia nada ao portal. Quando a pessoa confirma que enviou,
-- guardamos:
--   portal_key   — portal detectado pela URL da vaga no momento do envio
--                  (ex.: gupy, linkedin, indeed, glassdoor, other);
--   evidence_url — link opcional de evidência (página de confirmação,
--                  e-mail enviado, print hospedado etc.).
--
-- Ambos são NULL para candidaturas anteriores a esta migração e podem ser
-- preenchidos depois, enquanto a candidatura existir.

ALTER TABLE applications ADD COLUMN portal_key TEXT;
ALTER TABLE applications ADD COLUMN evidence_url TEXT;
