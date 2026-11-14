# RapidAPI — JSearch implementado

> **Status em 2026-11-13:** conector implementado em `backend/src/connectors/rapidapiJsearch.ts` e
> validado por uma execução real do pipeline (4/4 fontes ok; 19 vagas de estágio, 9 presenciais em
> Curitiba e 10 remotas). A chave fica apenas no `.env` local (gitignored). O endpoint usado é
> `/search-v2`; o antigo `/search` responde 404.

## Por que a decisão não é automática

As APIs de vagas do RapidAPI (JSearch, scrapers de LinkedIn etc.) **não são APIs oficiais** dos
portais. Elas raspam vagas públicas de Google Jobs, LinkedIn, Indeed e Glassdoor. Isso traz três
riscos que precisam estar claros antes de usar:

1. **Termos de uso:** a raspagem pode violar os termos do portal de origem, mesmo que a API
   intermediária diga o contrário.
2. **Estabilidade:** o formato pode mudar sem aviso, e a API pode ser descontinuada. Já aconteceu:
   o endpoint `/search` documentado antigamente hoje responde `404`; o atual é `/search-v2`.
3. **Custo:** a cota gratuita é limitada; depois dela, a API passa a cobrar. Não há orçamento
   aprovado para ultrapassar a cota.

O JobPilot **não** contorna login, CAPTCHA ou bloqueio. Se a API responder `401`, `403` ou `429`, a
fonte falha de forma isolada (`search_runs.status='partial'`) e as demais continuam.

## Resultado da validação real (2026-11-10)

Requisição feita uma única vez, fora do repositório, sem gravar nada no banco:

```text
GET https://jsearch.p.rapidapi.com/search-v2
  ?query=est%C3%A1gio%20Curitiba
  &page=1&num_pages=1&country=br&date_posted=month
```

| Métrica | Resultado |
| --- | --- |
| Status HTTP | **200** |
| Tempo | **4,6 s** |
| Tamanho | **31.080 bytes** |
| Vagas retornadas | **10** |
| Estágio (título/tipo) | **9 de 10** |
| Curitiba | **10 de 10** |
| Remotas | **0** |
| Cota | **200/mês**; **195 restantes** após as sondagens |

**Formato da resposta:** `{ status, request_id, parameters, data: { jobs: [...] } }`. O antigo
`data[]` não existe mais. Campos úteis confirmados (39 no total): `job_id`, `job_title`,
`employer_name`, `job_city`, `job_country`, `job_employment_type`, `job_is_remote`,
`job_description`, `job_apply_link`, `job_google_link`, `job_publisher`,
`job_posted_at_datetime_utc`, `job_min_salary`, `job_max_salary`, `job_salary_string`,
`job_benefits`, `job_highlights` e `apply_options`.

**Achados que mudam o mapeamento:**

- `job_employment_type` vem **localizado em português** (“Estágio”, “Prestador de serviços”,
  “Meio período”, “Tempo integral”), não como `INTERN`. O conector precisa normalizar o texto e
  nunca presumir estágio pelo campo bruto.
- `job_posted_at_datetime_utc` veio **nulo nas 10 vagas**. A data fica indefinida; não inventar.
- Os links de candidatura vão para os portais de origem (Catho, Indeed, TOTVS, TalentBrand,
  trabajo.org). O JobPilot apenas abre o link; o envio continua humano.
- A consulta “estágio Curitiba” **não** trouxe vagas remotas. Para cobrir home office foi adicionada
  uma segunda consulta (“estágio remoto Brasil”), o que dobra o consumo de cota.

## Execução real pelo pipeline (2026-11-13)

Coleta completa em banco temporário, com as quatro fontes habilitadas:

| Fonte | Resultado |
| --- | --- |
| Remotive | ok — 0 novas, 6 filtradas |
| Remote OK | ok — 4 novas, 94 filtradas |
| Nube | ok — 32 novas |
| **JSearch** | **ok — 19 novas, 1 duplicada, 0 filtradas** |

- **19 de 19** vagas do JSearch eram estágio: **9 presenciais em Curitiba** e **10 remotas**.
- Empresas reais reveladas: Positivo Tecnologia, Hospital Pequeno Príncipe, Votorantim Cimentos,
  CCEE, Construmarket, entre outras.
- `salaryText` e `postedAt` ficaram nulos quando a fonte não informou — nada foi inventado.
- Nenhuma vaga foi gravada no banco real durante a validação.
- `supportState` passou de `"unverified"` para `"verified"` após essa execução.

## Candidatos

| Endpoint | O que entrega | Prós | Contras |
| --- | --- | --- | --- |
| **JSearch** (`jsearch.p.rapidapi.com`, `/search-v2`) | Agrega Google Jobs, LinkedIn, Indeed e Glassdoor | Boa cobertura BR; 9/10 estágios em Curitiba na validação | Não é oficial; cota de 200/mês; formato mudou de `/search` para `/search-v2` |
| **Scrapers de LinkedIn** | Vagas públicas do LinkedIn | Cobertura alta de vagas corporativas | Cada provedor tem formato próprio; maior risco de bloqueio/quebra; ToS mais sensível |

**Decisão:** o **JSearch** com `/search-v2` foi implementado. Os scrapers de LinkedIn ficam como
alternativa posterior, nunca como base única.

## Contrato implementado

O conector segue o mesmo `SourceConnector` das demais fontes:

```ts
readonly key = "rapidapi-jsearch";
readonly name = "JSearch (RapidAPI)";
readonly kind = "api";
readonly supportState = "verified"; // após execução real pelo pipeline em 2026-11-13
readonly timeoutMs = 45_000;
verify(): Promise<{ ok: boolean; reason?: string }>;
fetch(ctx: ConnectorContext): AsyncIterable<RawJob>;
```

### Variáveis de ambiente

```dotenv
# Somente no .env da raiz (gitignored). Nunca no frontend, nos logs ou no repositório.
RAPIDAPI_KEY=...
RAPIDAPI_HOST=jsearch.p.rapidapi.com
```

A chave é lida no backend e enviada apenas no header `X-RapidAPI-Key`. O conector não deve
registrá-la em `execution_logs`, mensagens de erro ou `payload_json`.

### Consultas usadas

| Consulta | Objetivo | Custo por execução |
| --- | --- | --- |
| `estágio Curitiba`, `country=br`, `date_posted=month` | Estágios presenciais/híbridos em Curitiba | 1 requisição |
| `estágio remoto Brasil`, `country=br`, `date_posted=month` | Estágios home office | 1 requisição |

Com uma coleta diária, isso consome ~60 das 200 requisições/mês. O conector deve usar **uma página**
(`num_pages=1`) e cache de 15 min; se a cota apertar, reduzir para uma consulta por execução.

### Mapeamento implementado (JSearch `/search-v2`)

| Campo da API | Campo do `RawJob` |
| --- | --- |
| `data.jobs[].job_id` | `externalId` |
| `job_apply_link` (fallback `job_google_link`) | `sourceUrl` |
| `job_title` | `title` |
| `employer_name` | `company` |
| `job_city` + `job_country` | `location` |
| `job_is_remote` | `workMode` (`remote`/`onsite`; híbrido só se a fonte informar) |
| `job_employment_type` normalizado | `contractType` (`internship` só para “estágio/estagiário”) |
| `job_description` | `descriptionText` (HTML → texto) |
| `job_posted_at_datetime_utc` | `postedAt` (quando não nulo) |
| payload cru | `raw` |

Regras: não inventar empresa, salário ou data; vagas sem URL ou título são descartadas; cache de
15 min; `maxJobs` respeitado; nenhuma candidatura automática e nenhum envio de currículo.

## Checklist

- [x] Você escolheu **JSearch**.
- [x] Você criou a conta no RapidAPI e assinou o endpoint (plano gratuito).
- [x] A chave está no `.env` local (nunca commitada).
- [x] Uma consulta real foi feita e registrada em `docs/FONTES.md` com data, status, campos e cota.
- [x] A cobertura foi comparada com a Nube: 19 estágios (9 em Curitiba, 10 remotos) em 2026-11-13.
- [x] O conector foi implementado com testes offline e `supportState: "unverified"` no primeiro momento.
- [x] A execução real pelo pipeline passou (4/4 fontes ok) e o estado virou `"verified"`.
- [ ] Você confirmou que leu e aceita os termos de uso do provedor e dos portais de origem.

## O que está pronto

- Conector `rapidapiJsearch` com cache de 15 min, duas consultas e `timeoutMs = 45 s`.
- Suporte a cabeçalhos extras no `fetchJson`/`safeFetch`, com recusa de CR/LF e remoção do segredo
  quando um redirecionamento muda de host.
- Chave lida do `.env` e enviada só no header; nunca aparece em logs ou erros.
- Testes offline: 16 do conector, 3 de cabeçalhos e 3 de configuração.
- Registro da validação real em `docs/FONTES.md`.

## O que falta

- Sua confirmação sobre os termos de uso do provedor e dos portais de origem.
- Monitorar a cota mensal (200) e decidir se a fonte continua valendo a pena.
- Reavaliar a cobertura de vagas híbridas (a fonte só informa remoto/sem remoto).
