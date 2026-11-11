# RapidAPI — JSearch validado (conector não implementado)

> **Status em 2026-11-10:** chave criada por você e guardada apenas no `.env` local (gitignored).
> **Uma consulta real** ao JSearch foi executada e registrada em `docs/FONTES.md`. **Nenhum código**
> do conector foi adicionado ao repositório. A implementação ainda depende da sua aprovação.

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
- A consulta “estágio Curitiba” **não** trouxe vagas remotas. Para cobrir home office seria preciso
  uma segunda consulta (“estágio remoto Brasil”), o que dobraria o consumo de cota.

## Candidatos

| Endpoint | O que entrega | Prós | Contras |
| --- | --- | --- | --- |
| **JSearch** (`jsearch.p.rapidapi.com`, `/search-v2`) | Agrega Google Jobs, LinkedIn, Indeed e Glassdoor | Boa cobertura BR; 9/10 estágios em Curitiba na validação | Não é oficial; cota de 200/mês; formato mudou de `/search` para `/search-v2` |
| **Scrapers de LinkedIn** | Vagas públicas do LinkedIn | Cobertura alta de vagas corporativas | Cada provedor tem formato próprio; maior risco de bloqueio/quebra; ToS mais sensível |

**Recomendação técnica:** se for implementar, usar o **JSearch** com `/search-v2`. Os scrapers de
LinkedIn ficam como alternativa posterior, nunca como base única.

## Contrato previsto

O futuro conector seguirá o mesmo `SourceConnector` das demais fontes:

```ts
readonly key = "rapidapi-jsearch";
readonly name = "JSearch (RapidAPI)";
readonly kind = "api";
readonly supportState = "unverified"; // só vira "verified" após execução real pelo pipeline
readonly timeoutMs = 30_000;
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

### Consultas previstas

| Consulta | Objetivo | Custo por execução |
| --- | --- | --- |
| `estágio Curitiba`, `country=br`, `date_posted=month` | Estágios presenciais/híbridos em Curitiba | 1 requisição |
| `estágio remoto Brasil`, `country=br`, `date_posted=month` | Estágios home office | 1 requisição |

Com uma coleta diária, isso consome ~60 das 200 requisições/mês. O conector deve usar **uma página**
(`num_pages=1`) e cache de 15 min; se a cota apertar, reduzir para uma consulta por execução.

### Mapeamento previsto (JSearch `/search-v2`)

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

## Checklist antes de implementar

- [x] Você escolheu **JSearch**.
- [x] Você criou a conta no RapidAPI e assinou o endpoint (plano gratuito).
- [x] A chave está no `.env` local (nunca commitada).
- [x] Uma consulta real foi feita e registrada em `docs/FONTES.md` com data, status, campos e cota.
- [ ] Você confirmou que leu e aceita os termos de uso do provedor e dos portais de origem.
- [ ] A cobertura de estágio em Curitiba/remoto foi comparada com a Nube.
- [ ] O conector foi implementado com `supportState: "unverified"` e testes offline com fixture.
- [ ] Só depois da execução real pelo pipeline o estado vira `"verified"`.

## O que já está pronto

- O contrato `SourceConnector` aceita `timeoutMs` por fonte e `supportState`.
- O pipeline de coleta isola falha por fonte, deduplica e grava pelo mesmo caminho do cadastro manual.
- A chave está configurada localmente e a validação real está registrada em `docs/FONTES.md`.
- A Nube cobre o recorte brasileiro sem chave; a RapidAPI seria uma **fonte adicional**, não um
  substituto.

## O que falta

- Sua confirmação sobre os termos de uso e a comparação de cobertura com a Nube.
- Implementação do conector, testes offline e execução real pelo pipeline.
- Revisão de custo/cota e da decisão de manter ou remover a fonte.
