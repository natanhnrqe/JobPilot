# Fontes de vagas — registro de verificação

> Esta página documenta **o que foi verificado na prática** antes de cada conector existir no
> código. Nenhum conector aparece aqui como "funcionando" sem ter sido testado com resposta real.
>
> **Metodologia:** requisição real à API com `User-Agent` identificável, conferência do corpo da
> resposta, dos campos efetivamente presentes e das condições de uso publicadas. Datas de verificação:
> Remotive em **2026-11-03**; Remote OK em **2026-11-04** (com reconferência de parâmetros e tags).

## Resumo

| Fonte                 | Status no código    | Acesso            | Verificada em |
| --------------------- | ------------------- | ----------------- | ------------- |
| Remotive              | ✅ implementada     | API pública (GET) | 2026-11-03    |
| Remote OK             | ✅ implementada     | API pública (GET) | 2026-11-04    |
| Arbeitnow             | ❌ não implementada | API pública (GET) | 2026-11-03    |
| Hacker News (Algolia) | ❌ não implementada | API pública (GET) | 2026-11-03    |

---

## Remotive — implementada (`backend/src/connectors/remotive.ts`)

- **Documentação oficial:** <https://remotive.com/api-documentation> (repositório
  <https://github.com/remotive-com/remote-jobs-api>).
- **Acesso:** `GET https://remotive.com/api/remote-jobs` — sem chave, sem cadastro. O endpoint
  legado `remotive.io` foi descontinuado (usar `remotive.com`).
- **Formato:** `{ "job-count": n, "total-job-count": n, "jobs": [...] }`.
- **Campos efetivamente presentes** (todos conferidos na resposta real):
  `id`, `url`, `title`, `company_name`, `company_logo`, `category`, `tags`, `job_type`,
  `publication_date`, `candidate_required_location`, `salary`, `description` (HTML).
- **Campos usados pelo conector:** `id` (→ `external_id`), `url` (→ `source_url`), `title`,
  `company_name`, `candidate_required_location` (→ localização), `job_type` (só
  `internship`/`freelance` viram tipo de contrato; o resto fica `unknown` — a fonte não informa
  nível), `salary`, `description` (HTML convertido em texto), `publication_date` (→ `posted_at`),
  `category` (filtro).
- **Limitações conhecidas:**
  - os parâmetros de consulta documentados (`search`, `category`, `limit`, `company_name`) são
    **ignorados** pelo servidor: respostas com parâmetros diferentes tinham o mesmo corpo (161734
    bytes, mesmo hash). O filtro de categoria é feito **no cliente**;
  - a resposta traz sempre um lote pequeno (10 vagas mais recentes na verificação) — não é um feed
    completo histórico;
  - `publication_date` vem **sem fuso horário** (ex.: `2026-10-29T18:22:41`); o conector assume UTC
    e grava com `Z`. Se a fonte documentar outro fuso no futuro, ajustar;
  - `job_type` não distingue júnior/pleno/sênior.
- **Condições de uso (termos da própria API):** vincular de volta ao Remotive e **mencionar o
  Remotive como fonte**; não reenviar vagas a sites terceiros (Jooble, Neuvoo, Google Jobs,
  LinkedIn); vagas atrasadas 24 h; limite sugerido de ~4 requisições/dia, mais de 2/min é bloqueado.
  O JobPilot usa 1 requisição por execução (cache de 15 min entre `verify()` e `fetch()`).
- **Verificação:** resposta HTTP 200 com JSON válido; campos acima conferidos campo a campo;
  condições de uso lidas na própria resposta e na documentação.
- **Cobertura de testes:** `backend/tests/unit/remotive.test.ts` — **13 testes offline** com payload
  fixo (servidor local), cobrindo verificação, cache (1 requisição para `verify`+`fetch`), mapeamento
  de campos, remoção de HTML, filtro de categoria, limites (`maxJobs`, abort) e falhas (resposta
  inesperada, HTTP 429, vaga sem url/título).

## Remote OK — implementada (`backend/src/connectors/remoteok.ts`)

- **Documentação oficial:** a própria resposta da API traz os termos; painel público em
  <https://remoteok.com/api>.
- **Acesso:** `GET https://remoteok.com/api` — sem chave. Responde um **array** cujo primeiro
  elemento é um aviso legal (objeto sem `position`), seguido das vagas.
- **Campos efetivamente presentes** (conferidos): `slug`, `id`, `epoch`, `date`, `company`,
  `position`, `tags`, `description` (HTML), `location`, `apply_url`, `salary_min`, `salary_max`,
  `url`, `logo`.
- **Campos usados pelo conector:** `id` (→ `external_id`), `url` (fallback `apply_url`, →
  `source_url`), `position` (→ título), `company`, `location`, `description` (HTML convertido em
  texto), `date` (ISO com fuso → `posted_at`; `epoch` como fallback), `salary_min`/`salary_max`
  (→ texto de salário), `workMode` fixo em `remote` (a fonte é 100% remota por definição).
- **Limitações conhecidas:**
  - os parâmetros de consulta (`?tags=dev`, `?tag=dev`) são **ignorados**: as três respostas
    trouxeram as mesmas 99 vagas. Não há filtro no servidor;
  - filtrar por `tags` no cliente **não é confiável**: "Front End Developer" veio apenas com
    `["front end", "other"]`, e 69 das 99 vagas tinham alguma tag "dev-ish". Por isso o conector
    **não filtra** — a triagem fica no JobPilot;
  - ~100 vagas por resposta (as mais recentes), não é um histórico completo;
  - `salary_min`/`salary_max` são números **sem moeda**: o conector reproduz o número (ex.: `4000`)
    ou a faixa (`3000–5000`) e **não inventa** símbolo/moeda;
  - a fonte não informa nível nem tipo de contrato: `contractType` fica `unknown` (as `tags` não
    são fonte confiável para isso);
  - `date` já vem em ISO com fuso (`2026-11-03T16:00:25+00:00`), normalizada para UTC.
- **Condições de uso (termos da própria API):** vincular de volta com `follow` (sem `nofollow`) e
  mencionar "Remote OK" como fonte; não usar o logo sem permissão (marca registrada).
- **Verificação:** resposta HTTP 200 com array JSON válido; campos acima conferidos campo a campo;
  termos lidos no próprio corpo da resposta (`legal`); execução real de coleta com banco temporário
  gravou 98 vagas novas e 1 duplicada (fonte ok).
- **Cobertura de testes:** `backend/tests/unit/remoteok.test.ts` — **11 testes offline** com payload
  fixo (servidor local), cobrindo verificação, cache (1 requisição para `verify`+`fetch`), descarte
  do aviso legal e de vagas sem URL, mapeamento de campos, remoção de HTML, salário sem moeda,
  data com fallback de `epoch`, limites (`maxJobs`, abort) e falhas (resposta inesperada, HTTP 429).

## Arbeitnow — verificada, não implementada

- **Acesso:** `GET https://www.arbeitnow.com/api/job-board-api` — sem chave.
- **Formato:** `{ "data": [...], "links": { "next": "..." } }`.
- **Campos presentes:** `slug`, `company_name`, `title`, `description` (HTML), `remote` (bool),
  `url`, `tags`, `job_types`, `location`, `created_at`.
- **Limitações:** foco na **Alemanha** (menos relevante para vaga de estágio/júnior remoto do
  Brasil); paginação por `links.next`; **não localizamos página oficial de documentação** com
  condições de uso claras na data da verificação.
- **Status:** por não ter termos oficiais verificáveis, **não foi implementada** (regra desta Fase:
  só fontes com condições de uso conhecidas entram no código).

## Hacker News via Algolia — verificada, não implementada

- **Acesso:** `GET https://hn.algolia.com/api/v1/search?tags=story&query=...` — API pública da
  Algolia sobre o HN.
- **Formato:** `{ "hits": [...] }` com `objectID`, `title`, `story_text`, `url`, `created_at`,
  `author`, `points`.
- **Limitações:** as vagas do HN aparecem **dentro do texto dos comentários** das threads mensais
  "Who is hiring" — exigiria parsing de texto livre e classificação, com risco alto de erro; a
  página de documentação oficial é uma aplicação JavaScript (não foi possível ler conteúdo via
  requisição simples na data da verificação).
- **Status:** não implementada neste momento; reconsiderar apenas com um escopo de parsing bem
  definido e testado.

---

## Regras que valem para qualquer fonte

1. **Verificar antes de implementar:** documentação oficial, disponibilidade real, campos
   efetivamente presentes e condições de uso — registrados nesta página com data.
2. **Sem resposta fake:** nenhum conector é anunciado como funcionando sem verificação real; os
   testes da suíte usam payloads fixos para manter `npm test` offline.
3. **Mesmo caminho de persistência:** toda vaga coletada passa por validação → normalização →
   deduplicação → gravação pelos mesmos serviços do cadastro manual.
4. **User-Agent identificável:** `JobPilot/0.1 (local; contato: usuario-local)` — trocar o contato
   pelo seu e-mail antes de uso em volume.
5. **Respeitar limites:** 1 requisição por fonte por execução (cache), timeout de 30 s por fonte e
   falha de uma fonte **nunca** aborta as demais.
