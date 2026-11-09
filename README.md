# JobPilot

Aplicação **local** para cadastrar, organizar e acompanhar vagas de emprego e candidaturas — dashboard com vagas e candidaturas, status validados, histórico, **cadastro assistido por IA**, **perfil profissional com importação de currículo** e **análise de compatibilidade por IA**.

> 📘 Especificação completa: [`docs/ESPECIFICACAO-TECNICA.md`](docs/ESPECIFICACAO-TECNICA.md) · Escopo funcional: [`docs/ESCOPO.md`](docs/ESCOPO.md) · IA: [`docs/IA.md`](docs/IA.md)

## O que está implementado

**Marco 1**

- ✅ Cadastro, listagem, busca, filtros, edição, exclusão (lógica) e restauração de **vagas**
- ✅ **Candidaturas** 1:1 com a vaga, com status próprio e data de envio **declarada pelo usuário**
- ✅ Máquinas de estado separadas para vaga e candidatura, **validadas no backend** (transições inválidas → 409)
- ✅ **Histórico de eventos** (criação, mudanças de status, exclusões, notas) gravado na mesma transação
- ✅ **Notas** vinculadas à vaga ou à candidatura (criar, editar, excluir)
- ✅ **Dashboard** com contadores reais do banco e atividade recente
- ✅ **Backup e restauração** do banco SQLite com validação de integridade e rollback automático
- ✅ Configurações locais (nome de exibição, fuso horário)

**Fase 2 — cadastro assistido por IA**

- ✅ **Vagas com IA**: informe a URL ou cole a descrição → a IA estrutura os campos → **prévia editável** → você confirma → a vaga entra pelo mesmo serviço do cadastro manual
- ✅ Obtenção de conteúdo por **URL com proteções** (só http/https, bloqueio de SSRF, limites de tempo/tamanho/tipo, sem executar JavaScript)
- ✅ **Detecção de duplicatas** na prévia (URL normalizada; empresa+cargo como indício) — a decisão é sempre sua
- ✅ Campos não identificados ficam **vazios**; a data atual nunca vira data de publicação
- ✅ Sem chave de IA, o restante do JobPilot segue funcionando normalmente
- ✅ Falhas transitórias do provedor (429/5xx, incluindo o 503 de sobrecarga do Gemini) são repetidas até 3 vezes com espera crescente

**Fase 2 — coleta de vagas**

- ✅ **Conectores Remotive e Remote OK** verificados na prática (APIs públicas) e registrados em [`docs/FONTES.md`](docs/FONTES.md)
- ✅ **CLI de coleta** (`npm run collect`): busca as fontes, grava pelo mesmo caminho do cadastro manual, deduplica e registra a execução em `search_runs` + `execution_logs`
- ✅ **Lock de execução** (`data/.lock`): duas execuções simultâneas → a segunda fica `skipped`, sem corromper dados
- ✅ Falha de uma fonte **não derruba as demais** (`status='partial'`) e o resumo fica em `data/last-run.json`
- ✅ **Agendamento diário às 18:00** no Windows via `scripts/install-task.ps1` (o PC precisa estar ligado)
- ✅ **Página de Execuções** (`/execucoes`): histórico de `search_runs`, logs passo a passo de `execution_logs`, fontes registradas e o resumo de `data/last-run.json`

**Fase 3 — preferências de busca (fatia 1)**

- ✅ **Preferências em Configurações**: tipos de contrato desejados e opção de incluir vagas sem nível informado
- ✅ **Filtro aplicado na coleta** (manual e das 18:00): a vaga fora das preferências nem entra no banco; o resumo mostra quantas foram filtradas
- ✅ **Classificação pelo título** quando a fonte não informa o nível (caso do Remote OK): heurística conservadora, gravada como `contract_type_source = 'title'` e exibida como “classificado pelo título”
- ✅ Padrão inicial: estágio, júnior/trainee e freelance, sem vagas de nível desconhecido — ajustável a qualquer momento
- ✅ **Sem IA nesta etapa**: os filtros são determinísticos e não consomem chave nem créditos

**Fase 3 — perfil profissional e currículo (fatia 2)**

- ✅ **Página Perfil** (`/perfil`): importe o currículo em **PDF, DOCX ou TXT**, veja a prévia extraída pela IA, corrija o que precisar e confirme
- ✅ **Regra da citação**: todo item extraído precisa de um trecho literal do CV (`source_quote`); sem citação, o item é descartado — a IA não inventa qualificações
- ✅ **Itens inferidos** (ex.: tempo de experiência calculado) só entram depois de confirmação explícita, item a item
- ✅ **Privacidade**: o arquivo original do CV **não é armazenado**; ficam no banco local apenas o texto extraído e os dados revisados
- ✅ **Edição manual** de dados pessoais, experiências, formação, habilidades, idiomas, projetos, preferências profissionais e respostas padrão para formulários
- ✅ Rotas `GET/PUT /api/v1/profile`, `POST /api/v1/profile/cv` (prévia, não persiste) e `POST /api/v1/profile/cv/confirm`

✅ **269 testes automatizados** (domínio, API, extração de vagas e CV, PDF/DOCX, análise de compatibilidade, orçamento diário de IA, candidatura assistida, rascunho de candidatura com IA, provedor real de IA por loopback com retentativas, SSRF, duplicatas, config, backup/restore, conectores, coleta, preferências de busca, perfil, execuções e lock) — 100% offline, sem chave de IA e sem rede externa.

**Não implementado** (por design, por enquanto): envio automatizado nos portais (os alvos vedam bots — ver [`docs/PORTAIS.md`](docs/PORTAIS.md)), análise em lote, Playwright e lembretes.

## Requisitos

- **Node.js ≥ 22.5** (testado no Node 24) — usa o módulo nativo `node:sqlite`
- Windows (testado) — deve funcionar também em Linux/macOS (a leitura de PDF usa binários pré-compilados do `@napi-rs/canvas`)
- Navegador atual

## Instalação

```powershell
# na raiz do repositório
npm install
```

Nenhum `.env` é necessário (há padrões sensatos; veja `.env.example` para sobrescrever porta/host/caminhos). Para ligar o **cadastro assistido por IA**, defina `AI_API_KEY` (opcional — veja [`docs/IA.md`](docs/IA.md)).

## Executar

**Desenvolvimento** (backend na porta 3000 + frontend na 5173, com proxy `/api`):

```powershell
npm run dev
```

Abra **http://localhost:5173**.

**Produção local** (backend serve a UI compilada — um só processo):

```powershell
npm run build
npm start
```

Abra **http://127.0.0.1:3000**.

> A API escuta **somente em 127.0.0.1** — não é exposta à rede local.

## Testes e compilação

```powershell
npm test        # suíte completa (backend); offline, banco temporário por teste
npm run build   # compila backend (tsc) e frontend (vite)
```

## Migrações do banco

A migração roda automaticamente na primeira execução do servidor. Para rodar manualmente:

```powershell
npm run db:migrate
```

## Coleta de vagas (CLI)

Busca as fontes verificadas (Remotive e Remote OK) e grava as vagas novas:

```powershell
npm run collect
```

- Roda **sem** o servidor da API (acessa o SQLite diretamente).
- Cada execução é registrada em `search_runs` e `execution_logs`; o resumo também fica em `data/last-run.json`.
- Duas execuções simultâneas não se atropelam: a segunda é registrada como `skipped` (lock em `data/.lock`).
- Código de saída: `0` para sucesso/parcial, `1` para falha total.
- O agendamento automático (Windows, 18:00) usa `scripts/install-task.ps1`; veja a seção seguinte.

Fontes, campos, limites e condições de uso: [`docs/FONTES.md`](docs/FONTES.md).

## Preferências de busca

Em **Configurações → Preferências de busca** você escolhe quais tipos de contrato a coleta deve aceitar: estágio, júnior/trainee, pleno, sênior e freelance. A regra vale para a próxima coleta (manual ou automática das 18:00) e **não altera vagas já cadastradas**.

- **Nenhum tipo marcado** = sem filtro por tipo de contrato (a coleta aceita tudo, como antes).
- **Incluir vagas sem nível informado**: quando marcado, vagas cujo nível a fonte não informa e o título não permite classificar também entram.
- **Classificação pelo título**: se a fonte não informa o nível, o JobPilot aplica uma heurística conservadora ao título (“Estágio”, “Estagiário”, “Intern”, “Júnior”, “Jr”, “Trainee”, “Freelance”, “Pleno”, “Sênior”, “Sr”, “Lead”…). A vaga é marcada como **classificada pelo título** e guarda `contract_type_source = 'title'` — nunca é apresentada como informação da fonte.
- **Remote OK** não informa nível. Com o filtro estrito (sem “sem nível informado”), nenhuma vaga dele entra, a menos que o título permita a classificação.
- **Sem IA**: essa etapa é 100% determinística. A IA continua restrita ao cadastro assistido.

As rotas são `GET /api/v1/preferences` e `PUT /api/v1/preferences`.

## Perfil profissional e importação de currículo

Em **Perfil** (`/perfil`) você pode importar o currículo em **PDF, DOCX ou TXT** (até 5 MB) ou preencher o perfil manualmente. O fluxo de importação é sempre:

1. **Upload** do arquivo;
2. **Extração por IA** com prévia editável — nada é gravado ainda;
3. **Revisão humana** dos dados e confirmação dos itens inferidos;
4. **Confirmação** (`POST /profile/cv/confirm`), que só então salva o perfil.

Regras importantes:

- **A IA não inventa**: todo item extraído precisa de um trecho literal do CV (`source_quote`). Itens sem citação são descartados e aparecem nos avisos da prévia.
- **Itens inferidos** (ex.: tempo total de experiência) vêm marcados e exigem confirmação item a item; a confirmação é recusada enquanto houver pendências.
- **O arquivo original não é retido**: por privacidade, o banco guarda apenas o texto extraído (`raw_cv_text`) e os dados revisados. `cv_file_path` permanece vazio.
- **PDFs digitalizados** sem camada de texto precisam de OCR antes da importação; o JobPilot avisa quando não há texto suficiente.
- **Sem IA configurada**, a importação fica indisponível (`503`), mas o perfil pode ser preenchido e salvo manualmente.

As rotas são `GET /api/v1/profile`, `PUT /api/v1/profile`, `POST /api/v1/profile/cv` e `POST /api/v1/profile/cv/confirm`.

**Fase 3 — análise de compatibilidade por IA (fatia 3)**

- ✅ **Analisar com IA** no detalhe da vaga: a IA compara a descrição com o perfil salvo e devolve **score de 0 a 100**, resumo, justificativas com evidência (perfil ou vaga), requisitos obrigatórios/desejáveis, lacunas, informações desconhecidas, confiança e uma **sugestão** de aplicar
- ✅ **A IA não decide nada**: o status da vaga não é alterado, a vaga não é descartada automaticamente e o score **não é garantia de contratação**
- ✅ **Histórico versionado**: cada re-análise cria uma nova versão; as anteriores continuam visíveis no detalhe da vaga
- ✅ **Ranking**: a listagem pode ser ordenada por **prioridade** (status “Priorizada” primeiro, depois maior compatibilidade) ou por **compatibilidade**; o Dashboard mostra as melhores oportunidades
- ✅ **Regra conservadora**: ausência de informação no perfil vira `unknown`, não “não atende” — a IA só marca `missing` quando o perfil comprova que o requisito não é atendido
- ✅ Sem perfil preenchido, sem descrição suficiente ou sem `AI_API_KEY`, a análise é recusada com mensagem clara; o restante do JobPilot continua funcionando
- ✅ Rota `POST /api/v1/jobs/:id/analysis` (cria uma nova versão; o histórico vem em `GET /api/v1/jobs/:id`)

**Fase 3 — orçamento diário de IA (fatia 4)**

- ✅ **Teto diário de tokens** configurável em `AI_DAILY_BUDGET` (0 = sem limite), somando entrada + saída de **todas** as chamadas: extração de vagas, importação de currículo, análise de compatibilidade e rascunho de candidatura
- ✅ **Bloqueio antes de gastar**: ao atingir o teto, a próxima chamada é recusada com `429 AI_BUDGET_EXCEEDED` e nada é enviado ao provedor; o aviso fica visível na UI
- ✅ **Registro por chamada** em `ai_usage`: tipo, modelo, tokens de entrada/saída, data e marcação de estimativa quando o provedor não informa o consumo
- ✅ **Uso visível em Configurações**: tokens usados/restantes no dia, barra de progresso e detalhamento por tipo; o detalhe da vaga também avisa e desabilita o botão quando o teto foi atingido
- ✅ **Vira o dia** à meia-noite local (mesmo fuso da tarefa das 18:00) — o contador zera sozinho
- ✅ Rota `GET /api/v1/ai/usage` (somente leitura)

**Fase 4 — candidatura assistida (fatias 1 a 3)**

- ✅ **Sem envio automático**: os portais-alvo (Gupy, LinkedIn, Indeed e Glassdoor) vedam bots/automação; o JobPilot prepara os dados e **você** revisa e clica em enviar. Ver [`docs/PORTAIS.md`](docs/PORTAIS.md)
- ✅ **Kit de candidatura** no detalhe da vaga: portal detectado, dados de contato/links/resumo do perfil, habilidades, idiomas e respostas salvas — cada campo com botão **Copiar**
- ✅ **Checklist** do que está pronto/faltando: perfil, contato, links, link da vaga, descrição, análise e situação da vaga
- ✅ **Última análise** no kit: score, lacunas e requisitos obrigatórios que o perfil não atende
- ✅ **“Confirmo que enviei”** registra o envio **declarado** e a data (cria a candidatura se ainda não existir) — sem chamada ao portal
- ✅ **Portal e evidência**: o envio grava o portal detectado e aceita um link de evidência (confirmação, e-mail ou print); a evidência pode ser corrigida depois
- ✅ **Rascunho com IA (opcional)**: gera carta e respostas a partir do perfil + vaga + perguntas do formulário; cada trecho exige **citação literal verificada** do perfil ou da vaga, e o sistema descarta o que não for comprovável. A pessoa revisa, edita e copia — nada é enviado nem salvo como candidatura
- ✅ **Nada de login/CAPTCHA automatizado**; o kit é somente leitura e o rascunho consome IA pelo teto diário
- ✅ Rotas `GET /api/v1/jobs/:id/application-kit`, `POST /api/v1/jobs/:id/application/mark-sent`, `POST /api/v1/jobs/:id/application-draft` e `PATCH /api/v1/applications/:id` (com `evidenceUrl`)

## Página de Execuções

Com o servidor rodando, abra **<http://localhost:5173/execucoes>** em desenvolvimento (`npm run dev`) ou **<http://127.0.0.1:3000/execucoes>** com a interface compilada (`npm start`), ou clique em **Execuções** no menu. A página mostra:

- **Resumo da última coleta** gravado em `data/last-run.json`;
- **Fontes registradas** (Remotive, Remote OK) com estado de verificação e se estão habilitadas;
- **Histórico** das execuções com origem (manual/agendada), status, duração, contagens e resumo;
- **Logs** de cada execução (passo, nível, mensagem e detalhes) ao clicar em _Ver logs_.

As rotas usadas são somente leitura: `GET /api/v1/runs`, `GET /api/v1/runs/:id` e `GET /api/v1/sources`.

## Agendamento no Windows (18:00)

Para rodar a coleta automaticamente todos os dias às 18:00 (horário local), depois de `npm run build`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1
```

- **Não exige administrador**: a tarefa roda no contexto do usuário atual, quando ele está logado.
- **O PC precisa estar ligado e disponível no horário.** Se estiver desligado, a tarefa roda na próxima vez que o PC ligar (`StartWhenAvailable`); sem rede, é adiada (`RunOnlyIfNetworkAvailable`).
- Nunca empilha execuções (`MultipleInstances=IgnoreNew` + lock em `data/.lock`), com limite de 2 h por execução.
- Outro horário: `-At "19:30"`. Remover: `-Uninstall`.
- Resultados: `search_runs`/`execution_logs` no banco, `data/last-run.json` e `data/logs/`.

Acompanhe pela página **Execuções** (`/execucoes`) — veja a seção acima.

## Backup e restauração

Pela **UI** (Configurações) ou por linha de comando:

```powershell
npm run backup                                  # cria backup validado em data/backups/
npm run restore -- --file <nome-do-arquivo.sqlite> --yes
```

Detalhes do processo (validação, rollback automático, retenção): [`docs/BACKUP-RESTORE.md`](docs/BACKUP-RESTORE.md).

## Onde ficam os dados

| Conteúdo     | Caminho                | Versionado?                   |
| ------------ | ---------------------- | ----------------------------- |
| Banco SQLite | `data/jobpilot.sqlite` | Não (`data/` no `.gitignore`) |
| Backups      | `data/backups/`        | Não                           |
| Logs diários | `data/logs/`           | Não                           |

Apagar a pasta `data/` reinicia a aplicação vazia (os backups são perdidos juntos — copie-os antes).

## Estrutura

```
backend/    API HTTP (Express + zod), domínio (máquinas de estado), repositórios SQL,
            migrações em backend/migrations/, testes em backend/tests/
frontend/   React + TypeScript (Vite), páginas: Dashboard, Vagas, Candidaturas, Perfil, Execuções, Configurações
docs/       ESCOPO.md, ESPECIFICACAO-TECNICA.md, INSTALACAO.md, BACKUP-RESTORE.md, FONTES.md, IA.md
data/       banco, backups e logs (não versionado)
```

## Próximos marcos (resumo da especificação)

1. **Fase 2** — coleta automática de vagas de fontes verificadas + agendamento às 18:00
2. **Fase 3** — preferências de busca, perfil profissional com importação de CV, análise de compatibilidade por IA e teto diário de custo (fatias 1 a 4 concluídas)
3. **Fase 4** — **candidatura assistida**: kit de dados, checklist, envio declarado e rascunho de carta/respostas por IA com citações verificadas; sem bot, login automatizado ou CAPTCHA contornado (os portais-alvo vedam automação — ver [`docs/PORTAIS.md`](docs/PORTAIS.md))
4. **Fase 5** — lembretes de acompanhamento e consolidação

Regras permanentes: tentativa ≠ enviada; o JobPilot **nunca** envia candidatura sozinho nos portais-alvo; nada é declarado "suportado" sem verificação real.
