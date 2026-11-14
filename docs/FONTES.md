# Fontes de vagas — registro de verificação

> Esta página documenta **o que foi verificado na prática** antes de cada conector existir no
> código. Nenhum conector aparece aqui como "funcionando" sem ter sido testado com resposta real.
>
> **Metodologia:** requisição real à API com `User-Agent` identificável, conferência do corpo da
> resposta, dos campos efetivamente presentes e das condições de uso publicadas. Datas de verificação:
> Remotive em **2026-11-03**; Remote OK em **2026-11-04** (com reconferência de parâmetros e tags);
> Nube e GitHub Issues em **2026-11-10**; RapidAPI/JSearch em **2026-11-10** (consulta) e
> **2026-11-13** (execução real pelo pipeline).

## Resumo

| Fonte                          | Status no código    | Acesso                     | Verificada em |
| ------------------------------ | ------------------- | -------------------------- | ------------- |
| Remotive                       | ✅ implementada     | API pública (GET)          | 2026-11-03    |
| Remote OK                      | ✅ implementada     | API pública (GET)          | 2026-11-04    |
| Nube                           | ✅ implementada     | API pública (GET)          | 2026-11-10    |
| GitHub Issues                  | ❌ não implementada | API pública (GET)          | 2026-11-10    |
| RapidAPI (JSearch)             | ✅ implementada     | API de terceiro (chave)    | 2026-11-10    |
| Arbeitnow                      | ❌ não implementada | API pública (GET)          | 2026-11-03    |
| Hacker News (Algolia)          | ❌ não implementada | API pública (GET)          | 2026-11-03    |

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
  - a fonte não informa nível nem tipo de contrato: o conector entrega `contractType: unknown` (as
    `tags` não são fonte confiável para isso). Na coleta, o JobPilot pode classificar o tipo pelo
    título (ver “Preferências de busca” no README) e grava a origem como `contract_type_source =
    'title'` — o conector em si continua sem inventar dados;
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

## Nube — implementada (`backend/src/connectors/nube.ts`)

- **Acesso:** API pública do próprio portal, sem chave e sem login.
  - Listagem: `GET https://www.nube.com.br/api/portal/buscar_filtro_vagas?id_tipo_vaga=1&page_size=500&offset=N`
  - Detalhe: `GET https://www.nube.com.br/api/portal/buscar-detalhes-vaga/json?id_vaga=...&titulo=...`
- **Formato da listagem:** `{ param: { lista_ids_vaga, offset: { total, mostra_btn_mais }, dict_por_id_vaga } }`.
  Cada `dict_por_id_vaga[id].view` traz `id_vaga`, `titulo`, `cidade`, `uf`, `bolsa_valor`, `selo`
  (`home_office`, `hibrido`), `url`, `id_modalidade_atuacao`.
- **Formato do detalhe:** `param._jobposting_sch` com JSON-LD `JobPosting` (título, `datePosted`,
  `validThrough`, `employmentType`, `jobLocation`, `baseSalary`, `hiringOrganization`, `description`
  em HTML), além de `vaga_home_office`, `vaga_hibrida`, `texto_tipo_vaga` e `texto_valor_ba`.
- **Paginação real:** `page_size` funciona (testado com 24, 50, 100, 200 e 500). `limite` é ignorado
  e devolve ~3,1 MB de uma vez. Com `page_size=500`, a varredura completa custa 13 requisições,
  ~6,5 MB e ~54 s.
- **Cobertura real em 2026-11-10:**
  - a API reportou **6.062** estágios, mas apenas **~3.088 IDs únicos** são acessíveis: depois de
    ~3.000 a paginação repete vagas (a execução real do conector leu 3.085 e retornou 39 no recorte);
  - **25 em Curitiba** (23 presenciais + 2 híbridas), **28 na Grande Curitiba** e **11 home office**;
  - a execução real do conector no mesmo dia retornou **39 vagas** (26 presenciais, 2 híbridas e 11
    remotas), porque a listagem já havia mudado;
  - salários entre **R$ 900 e R$ 2.100**; todas as 36 vagas conferidas tinham `datePosted`,
    `validThrough`, salário e `employmentType: INTERN`.
- **Detalhe:** 15–22 KB por vaga, mediana de **100 ms** (mín. 19 ms, máx. 507 ms), descrição de
  ~976–1.858 caracteres antes da conversão para texto.
- **Campos usados pelo conector:** `id_vaga` (→ `external_id`), `url` (→ `source_url` absoluta),
  `titulo`/`title` (→ título, sem o sufixo ` - <id>`), `cidade`/`uf` (→ localização), `selo` e
  `vaga_home_office`/`vaga_hibrida` (→ modalidade), `bolsa_valor`/`texto_valor_ba` (→ salário),
  `description` (→ texto puro), `datePosted` (→ `posted_at`), `validThrough` (→ descarte de vencidas).
- **Limitações conhecidas:**
  - **não há filtro por cidade/estado** na API: o recorte Curitiba/Grande Curitiba é feito no cliente;
  - a paginação além de ~3.000 repete vagas; o conector deduplica por ID e limita a 20 páginas;
  - a empresa contratante quase nunca é revelada: em **35 de 36** vagas o `hiringOrganization` é a
    própria Nube (agente). Nesses casos `company` fica **indefinida** — a Nube nunca é gravada como
    empregadora. Quando o JSON-LD revela a empresa real (ex.: “Saber”), ela é usada;
  - a listagem não informa descrição; o conector busca o detalhe só das vagas do recorte
    (36 requisições, ~4 s). Se um detalhe falhar, usa os dados da listagem e uma descrição mínima
    factual, sem inventar data nem empresa;
  - vagas com `validThrough` anterior ao dia local são descartadas;
  - a varredura completa leva ~54 s, acima do timeout padrão de 30 s. O conector declara
    `timeoutMs = 120_000`; as demais fontes continuam com 30 s.
- **Condições de uso:** `robots.txt` permite `/api` (bloqueia apenas `/estudantes/gestor/`,
  `/empresas/gestor/` e `/escolas/gestor/`). A política de uso/privacidade não tem cláusula
  explícita contra ler vagas públicas, mas os itens 31–33 tratam de abuso e de “acesso a dados não
  autorizados”. Mitigações adotadas: **cache de 15 min**, User-Agent identificável, uma execução por
  vez, nenhum login, nenhuma candidatura automática e link de volta para a página da vaga.
- **Verificação:** `verify()` e `fetch()` reais contra a Nube em 2026-11-10; 3.085 IDs lidos, 39
  vagas aceitas, 26 presenciais / 2 híbridas / 11 remotas, 53,9 s; detalhes com JSON-LD válido e
  descrição em texto puro. Nenhuma vaga foi gravada no banco durante a verificação.
- **Cobertura de testes:** `backend/tests/unit/nube.test.ts` — **16 testes offline** com servidor
  local e payload fixo, cobrindo verificação, cache da primeira página, paginação e deduplicação,
  mapeamento de campos, empresa real vs. agente, modalidade, filtro Curitiba/remoto, descarte de
  vencidas, `maxJobs`, aborto, falha de detalhe (fallback) e falha de página posterior.

## GitHub Issues — verificada, não implementada

- **Acesso:** API pública de busca do GitHub (`/search/issues`), sem chave para leitura.
- **Repositórios conferidos em 2026-11-10:** `frontendbr/vagas`, `backend-br/vagas` e
  `react-brasil/vagas`.
- **Resultado:** 55 issues abertas no total (54 de vagas + 1 aviso fixo), **nenhuma** com
  “estágio/estagiário/intern/trainee” no título. Apenas **2** mencionavam Curitiba, ambas de nível
  sênior/tech lead; 23 eram remotas, majoritariamente pleno/sênior.
- **Limitações:** volume baixo para estágio, texto em Markdown livre (exigiria parsing e
  classificação), issues antigas/stale e rate limit de 10 buscas/min sem token (30/min com token).
- **Status:** não implementada. O custo de parsing não se justifica enquanto o volume de estágio for
  zero; pode ser reconsiderada como fonte complementar de “comunidade”.

## RapidAPI (JSearch) — implementada (`backend/src/connectors/rapidapiJsearch.ts`)

- **Plano detalhado:** [`docs/RAPIDAPI.md`](RAPIDAPI.md).
- **Acesso:** `GET https://jsearch.p.rapidapi.com/search-v2`, com os cabeçalhos `X-RapidAPI-Key`
  (só no `.env` gitignored) e `X-RapidAPI-Host`. O endpoint antigo `/search` responde
  `404 Endpoint '/search' does not exist`.
- **Status:** conector implementado em **2026-11-13**, com `supportState: "verified"` após execução
  real pelo pipeline. Nenhuma chave, requisição ou payload real está versionado.
- **Verificação real da consulta em 2026-11-10:**
  - requisição: `GET /search-v2?query=est%C3%A1gio%20Curitiba&page=1&num_pages=1&country=br&date_posted=month`;
  - resposta: **HTTP 200**, **4,6 s**, **31.080 bytes**, `status: "OK"`, **10 vagas**;
  - **9 de 10** eram estágio e **10 de 10** em Curitiba; **0 remotas** (a consulta foi presencial);
  - formato: `{ status, request_id, parameters, data: { jobs: [...] } }` — **não** é `data[]`;
  - campos presentes (39): `job_id`, `job_title`, `employer_name`, `job_city`, `job_country`,
    `job_employment_type`, `job_is_remote`, `job_description`, `job_apply_link`, `job_google_link`,
    `job_publisher`, `job_posted_at_datetime_utc`, `job_min_salary`/`job_max_salary`,
    `job_salary_string`, `job_benefits`, `job_highlights`, `apply_options`, entre outros;
  - `job_employment_type` vem **localizado em português** (“Estágio”, “Prestador de serviços”,
    “Meio período”, “Tempo integral”), não como `INTERN`; o conector normaliza o texto e também
    usa o título como fallback;
  - `job_posted_at_datetime_utc` veio **nulo nas 10 vagas** — a data não pode ser inventada;
  - os links de candidatura apontam para os portais de origem (Catho, Indeed, TOTVS, TalentBrand,
    trabajo.org), não para o RapidAPI;
  - cota gratuita observada: **200 requisições/mês** (`x-ratelimit-requests-limit: 200`), com
    **195 restantes** após as sondagens.
- **Execução real pelo pipeline em 2026-11-13 (banco temporário):**
  - **4/4 fontes ok**; JSearch com **19 novas**, 1 duplicada e 0 filtradas;
  - **19 de 19** vagas de estágio: **9 presenciais em Curitiba** e **10 remotas**;
  - empresas reais reveladas (Positivo Tecnologia, Hospital Pequeno Príncipe, Votorantim, CCEE…);
  - salário e `postedAt` ficaram nulos porque a fonte não os informou nessas vagas;
  - nenhuma vaga foi gravada no banco real durante a validação.
- **Consultas e consumo:** duas consultas por execução (`estágio Curitiba` e
  `estágio remoto Brasil`), `num_pages=1`, `country=br`, `date_posted=month`. Com uma coleta diária
  são ~60 das 200 requisições/mês. O payload fica em cache de 15 min, então `verify()` + `fetch()`
  custam uma requisição por consulta.
- **Campos usados pelo conector:** `job_id` (→ `external_id`), `job_apply_link` com fallback
  `job_google_link` (→ `source_url`), `job_title`, `employer_name`, `job_city`/`job_state`
  (→ localização), `job_is_remote` (→ `workMode`), `job_employment_type` + título (→ `contractType`),
  `job_salary_string` (→ salário), `job_description` (→ texto puro), `job_posted_at_datetime_utc`
  (→ `postedAt`, quando não nulo).
- **Limitações conhecidas:**
  - **não é API oficial:** é raspagem de terceiros (Google Jobs, LinkedIn, Indeed, Glassdoor), com
    risco de violação de termos, mudança de formato e cobrança após a cota;
  - `job_is_remote: false` é tratado como `onsite`; a fonte não distingue híbrido nessas vagas;
  - `job_employment_type` é localizado e pode divergir do título; o conector só marca `internship`
    quando o tipo **ou** o título indica estágio, e o restante fica `unknown`;
  - salário e data podem vir nulos; nunca são inventados;
  - a cota de 200/mês é pequena: se esgotar, a fonte falha isolada e as demais continuam;
  - links apontam para Catho/Indeed/Glassdoor/LinkedIn e outros portais; o envio continua humano.
- **Condições de uso:** a chave fica apenas no `.env` local e é enviada só no header; não aparece em
  logs, mensagens de erro ou `payload_json`. O conector não contorna login, CAPTCHA ou bloqueio;
  se a API responder 401/403/429, a fonte falha de forma isolada (`search_runs.status='partial'`).
- **Cobertura de testes:** `backend/tests/unit/rapidapiJsearch.test.ts` — **16 testes offline** com
  servidor local e fixture, cobrindo verificação, cache, cabeçalhos, formato atual e antigo,
  mapeamento, empresa/local/modalidade, deduplicação entre consultas, `maxJobs`, aborto, ausência de
  chave, 429 e recusa de chave com CR/LF. Também há 3 testes de cabeçalhos em `safeFetch.test.ts` e
  3 de configuração em `config.test.ts`.

## Regras que valem para qualquer fonte

1. **Verificar antes de implementar:** documentação oficial, disponibilidade real, campos
   efetivamente presentes e condições de uso — registrados nesta página com data.
2. **Sem resposta fake:** nenhum conector é anunciado como funcionando sem verificação real; os
   testes da suíte usam payloads fixos para manter `npm test` offline.
3. **Mesmo caminho de persistência:** toda vaga coletada passa por validação → normalização →
   deduplicação → gravação pelos mesmos serviços do cadastro manual.
4. **User-Agent identificável:** `JobPilot/0.1 (local; contato: usuario-local)` — trocar o contato
   pelo seu e-mail antes de uso em volume.
5. **Respeitar limites:** cache de 15 min, timeout padrão de 30 s por fonte (fontes com paginação
   pesada ou duas consultas podem declarar `timeoutMs` próprio: Nube 120 s, JSearch 45 s) e falha de
   uma fonte **nunca** aborta as demais.
