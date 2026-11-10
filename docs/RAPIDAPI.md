# RapidAPI — preparação (não implementado)

> **Status em 2026-11-10:** plano e contrato definidos; **nenhum código, nenhuma chave e nenhuma
> requisição** foram adicionados ao repositório. A implementação depende de você escolher o endpoint
> e criar a conta gratuita.

## Por que a decisão não é automática

As APIs de vagas do RapidAPI (JSearch, scrapers de LinkedIn etc.) **não são APIs oficiais** dos
portais. Elas raspam vagas públicas de Google Jobs, LinkedIn, Indeed e Glassdoor. Isso traz três
riscos que precisam estar claros antes de usar:

1. **Termos de uso:** a raspagem pode violar os termos do portal de origem, mesmo que a API
   intermediária diga o contrário.
2. **Estabilidade:** o formato pode mudar sem aviso, e a API pode ser descontinuada.
3. **Custo:** a cota gratuita é limitada; depois dela, a API passa a cobrar. Não há orçamento
   aprovado para ultrapassar a cota.

O JobPilot **não** contorna login, CAPTCHA ou bloqueio. Se a API responder `401`, `403` ou `429`, a
fonte falha de forma isolada (`search_runs.status='partial'`) e as demais continuam.

## Candidatos

| Endpoint | O que entrega | Prós | Contras |
| --- | --- | --- | --- |
| **JSearch** (`jsearch.p.rapidapi.com`) | Agrega Google Jobs, LinkedIn, Indeed e Glassdoor | Resposta relativamente estável; campos padronizados; boa cobertura BR | Não é oficial; cota gratuita pequena; pode exigir paginação |
| **Scrapers de LinkedIn** | Vagas públicas do LinkedIn | Cobertura alta de vagas corporativas | Cada provedor tem formato próprio; maior risco de bloqueio/quebra; ToS mais sensível |

**Recomendação técnica:** se for usar RapidAPI, começar pelo **JSearch**, porque o contrato é mais
previsível e permite um conector com fixture offline. Os scrapers de LinkedIn ficam como alternativa
posterior, nunca como base única.

## Contrato previsto

O futuro conector seguirá o mesmo `SourceConnector` das demais fontes:

```ts
readonly key = "rapidapi-jsearch";
readonly name = "JSearch (RapidAPI)";
readonly kind = "api";
readonly supportState = "unverified"; // só vira "verified" após validação real
readonly timeoutMs = 30_000;
verify(): Promise<{ ok: boolean; reason?: string }>;
fetch(ctx: ConnectorContext): AsyncIterable<RawJob>;
```

### Variáveis de ambiente (previstas)

```dotenv
# Somente no .env da raiz (gitignored). Nunca no frontend, nos logs ou no repositório.
RAPIDAPI_KEY=...
RAPIDAPI_HOST=jsearch.p.rapidapi.com
```

A chave será lida no backend e enviada apenas no header `X-RapidAPI-Key`. O conector não deve
registrá-la em `execution_logs`, mensagens de erro ou `payload_json`.

### Consulta inicial de validação

Antes de escrever o conector, rodar **uma** consulta real e registrar em `docs/FONTES.md`:

```text
GET https://jsearch.p.rapidapi.com/search?query=est%C3%A1gio%20Curitiba&page=1&num_pages=1&country=br
```

Conferir: status HTTP, tempo, tamanho, campos presentes, quantidade de vagas de estágio, se há
Curitiba/remoto e quais termos de uso/cota o provedor apresenta.

### Mapeamento previsto (JSearch)

| Campo da API | Campo do `RawJob` |
| --- | --- |
| `job_id` | `externalId` |
| `job_apply_link` (fallback `job_google_link`) | `sourceUrl` |
| `job_title` | `title` |
| `employer_name` | `company` |
| `job_city` + `job_country` | `location` |
| `job_is_remote` / `job_employment_type` | `workMode` / `contractType` |
| `job_description` | `descriptionText` (HTML → texto) |
| `job_posted_at_datetime_utc` | `postedAt` |
| payload cru | `raw` |

Regras: não inventar empresa, salário ou data; `contractType` só vira `internship` quando a fonte
informar; vagas sem URL ou título são descartadas; cache de 15 min; `maxJobs` respeitado.

## Checklist antes de implementar

- [ ] Você escolheu **JSearch** ou um scraper de LinkedIn específico.
- [ ] Você criou a conta no RapidAPI e assinou o endpoint (plano gratuito).
- [ ] A chave está no `.env` local (nunca commitada).
- [ ] Uma consulta real foi feita e registrada em `docs/FONTES.md` com data, status, campos e cota.
- [ ] Os termos de uso do provedor e do portal de origem foram lidos e aceitos por você.
- [ ] A cobertura de estágio em Curitiba/remoto foi comparada com a Nube.
- [ ] O conector foi implementado com `supportState: "unverified"` e testes offline com fixture.
- [ ] Só depois da execução real bem-sucedida o estado vira `"verified"`.

## O que já está pronto

- O contrato `SourceConnector` aceita `timeoutMs` por fonte e `supportState`.
- O pipeline de coleta isola falha por fonte, deduplica e grava pelo mesmo caminho do cadastro manual.
- O registro de fontes em `docs/FONTES.md` já tem a entrada de preparação.
- A Nube cobre o recorte brasileiro sem chave; a RapidAPI seria uma **fonte adicional**, não um
  substituto.

## O que falta

- Definição do endpoint e da chave.
- Validação real (uma consulta) e registro dos termos.
- Implementação do conector, testes offline e execução real.
- Revisão de custo/cota e da decisão de manter ou remover a fonte.
