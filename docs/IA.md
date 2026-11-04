# IA no JobPilot — cadastro assistido de vagas

> Escopo desta página: **Fase 2, etapa 1** (extração de campos de uma vaga para a prévia de
> cadastro). Análise de compatibilidade com currículo, extração de CV e priorização são Fase 3 e
> **não existem** neste projeto.

## 1. Provedor escolhido e por quê

Implementação: `backend/src/ai/provider.ts` (interface `AiProvider`) com uma única
implementação, `OpenAiCompatibleProvider`.

- **Formato:** API compatível com `POST /v1/chat/completions` da OpenAI, com
  `response_format: { type: "json_object" }` e `temperature: 0`.
- **Por quê:** é hoje o formato mais difundido — o mesmo código atende OpenAI, OpenRouter, Groq,
  DeepSeek e endpoints locais (Ollama, vLLM) só trocando `AI_BASE_URL` e `AI_MODEL`.
- **Por quê não um SDK por provedor:** o projeto é pequeno; uma abstração de ~90 linhas com
  validação `zod` na saída evita dependência extra e mantém a regra de negócio fora do provedor.
  Rotas HTTP, repositórios SQL e componentes React **não** importam o provedor diretamente — só a
  camada de serviço (`backend/src/services/extraction.ts`).

O conteúdo enviado ao provedor é **apenas** o texto da vaga (limitado a 20 000 caracteres) mais o
prompt. **Nenhum currículo, credencial, nota pessoal ou dado do banco é enviado.**

## 2. Como obter e configurar a chave

1. Crie a chave no painel do provedor que você escolher (ex.: `platform.openai.com` → API keys).
2. Copie `.env.example` para `.env` na **raiz do repositório** e preencha:

```env
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1   # opcional (default da OpenAI)
AI_MODEL=gpt-4o-mini                    # opcional (default)
AI_TIMEOUT_MS=60000                     # opcional (default 60 s)
```

3. Reinicie o backend. Confirme em `GET /api/v1/extractions/status` que `enabled: true`.

Regras de segurança:

- a chave fica **apenas** em variável de ambiente (`.env` está no `.gitignore`; só o
  `.env.example` é versionado e não contém chaves);
- ela **nunca** é devolvida pela API, gravada no SQLite, escrita em log ou incluída em backup;
- o frontend só consulta `/extractions/status` (`enabled`, `model`, `provider`).

## 3. Custos externos

- Cada extração faz **1 chamada** ao provedor (até 2, se a primeira resposta sair fora do esquema).
- O consumo é da **sua conta** no provedor e segue a tabela de preços dele — o JobPilot não tem
  contrato nem crédito próprio.
- Ordem de grandeza do custo: o prompt de extração é pequeno (centenas de tokens). Modelos como
  `gpt-4o-mini` custam centavos de dólar por milhares de extrações; modelos maiores podem custar
  dezenas de vezes mais. **Confirme o preço vigente no seu provedor antes de usar em volume.**
- `AI_TIMEOUT_MS` limita o tempo de cada chamada; não há limite de gasto configurado nesta etapa
  (orçamento diário é tarefa 3.4 da Fase 3).

## 4. Como testar sem consumir a API real

1. **Suíte automatizada (padrão, offline):** `npm test` usa um provedor falso
   (`backend/tests/fakeAi.ts`) — zero rede, zero chave. Cobre extração válida, campos ausentes,
   JSON inválido, esquema inválido, provedor indisponível, duplicatas, SSRF e HTML.
   Além do provedor falso, `backend/tests/integration/aiProvider.test.ts` exercita o **provedor
   real** contra um servidor local que emula a API da OpenAI: formato da requisição, 401/403, 429,
   5xx, timeout, conexão recusada e o fluxo completo (texto → extração real → prévia → confirmação →
   lista) — tudo por loopback, sem chave e sem rede externa.
2. **API local de mentira (smoke test manual):** suba um servidor que responda
   `/v1/chat/completions` com o JSON que quiser e aponte o JobPilot para ele:

```env
AI_API_KEY=qualquer-valor
AI_BASE_URL=http://127.0.0.1:5099/v1
AI_MODEL=mock-model
```

   Assim você exercita o caminho HTTP real (provedor → extração → prévia → gravação) sem gastar
   nada. Use apenas em máquina local.
3. **Provedor local real (opcional):** Ollama/vLLM em `localhost` com `AI_BASE_URL` correspondente.

## 5. Quando falta a chave, acaba a cota ou o serviço falha

| Situação                                              | O que acontece                                                                                       | Usuário vê                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Sem `AI_API_KEY`                                       | `config.ai = null`; nenhuma chamada externa é feita                                                   | aviso em `/vagas/nova` + `503 AI_UNAVAILABLE` na extração  |
| Chave recusada (401/403)                               | erro do provedor convertido                                                                          | `503 AI_UNAVAILABLE` com orientação de revisar `AI_API_KEY` |
| Cota/limite atingido (429)                             | idem                                                                                                | `503 AI_UNAVAILABLE` indicando cota                        |
| Rede/timed out                                         | `AbortSignal.timeout(AI_TIMEOUT_MS)`                                                                 | `503 AI_UNAVAILABLE` com o tempo limite                    |
| Resposta fora do esquema ou sem JSON                   | 2 tentativas; depois                                                                                 | `502 AI_INVALID_RESPONSE` com os problemas listados       |
| Erro 5xx do provedor                                   | falha                                                                                                | `502 AI_ERROR` com status e trecho (limitado)              |
| Página bloqueada (401/403/429), PDF, muito grande, destino privado | falha **antes** de chamar a IA                                                               | `400/413/415/422 FETCH_ERROR` + orientação de colar o texto |

Em **todos** os casos o restante do JobPilot (dashboard, vagas manuais, candidaturas, notas,
backup/restore) continua funcionando normalmente.

## 6. Limitações conhecidas

- **Sem JavaScript:** o conteúdo é obtido por HTTP simples; páginas que exigem JS/login podem
  ficar incompletas (a prévia avisa). Playwright não foi adicionado — só entrará se uma página
  real demonstrar necessidade.
- **Sem contornar proteções:** CAPTCHA, paywall e login não são burlados; o erro orienta a colar
  o texto manualmente.
- **A IA não inventa:** campo não identificado vem `null`; a data atual nunca vira `postedAt`;
  inferências aparecem em `extractionNotes` e a confiança é exibida na prévia.
- **Conteúdo é dado não confiável:** vai ao modelo entre `<<<CONTEUDO_DA_VAGA>>>` com instrução de
  ignorar comandos ali contidos; a extração não tem permissão de gravar no banco.
- **Sem análise de compatibilidade com currículo** nesta etapa (depende de D2/D4 na especificação).
