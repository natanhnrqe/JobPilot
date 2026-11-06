# JobPilot

Aplicação **local** para cadastrar, organizar e acompanhar vagas de emprego e candidaturas — dashboard com vagas e candidaturas, status validados, histórico e **cadastro assistido por IA** (Fase 2, etapa 1).

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

**Fase 2 — coleta de vagas**

- ✅ **Conectores Remotive e Remote OK** verificados na prática (APIs públicas) e registrados em [`docs/FONTES.md`](docs/FONTES.md)
- ✅ **CLI de coleta** (`npm run collect`): busca as fontes, grava pelo mesmo caminho do cadastro manual, deduplica e registra a execução em `search_runs` + `execution_logs`
- ✅ **Lock de execução** (`data/.lock`): duas execuções simultâneas → a segunda fica `skipped`, sem corromper dados
- ✅ Falha de uma fonte **não derruba as demais** (`status='partial'`) e o resumo fica em `data/last-run.json`
- ✅ **Agendamento diário às 18:00** no Windows via `scripts/install-task.ps1` (o PC precisa estar ligado)
- ✅ **Página de Execuções** (`/execucoes`): histórico de `search_runs`, logs passo a passo de `execution_logs`, fontes registradas e o resumo de `data/last-run.json`

✅ **169 testes automatizados** (domínio, API, extração, provedor real de IA por loopback, SSRF, duplicatas, config, backup/restore, conectores, coleta, execuções e lock) — 100% offline, sem chave de IA e sem rede externa.

**Não implementado** (por design, por enquanto): análise de compatibilidade com currículo, Playwright/automação de envio, upload de currículo e lembretes.

## Requisitos

- **Node.js ≥ 22.5** (testado no Node 24) — usa o módulo nativo `node:sqlite`
- Windows (testado) — deve funcionar também em Linux/macOS por não ter dependências nativas
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

## Página de Execuções

Com o servidor rodando (`npm run dev` ou `npm start`), abra **<http://127.0.0.1:3000/execucoes>** (ou clique em **Execuções** no menu). A página mostra:

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
frontend/   React + TypeScript (Vite), páginas: Dashboard, Vagas, Candidaturas, Configurações
docs/       ESCOPO.md, ESPECIFICACAO-TECNICA.md, INSTALACAO.md, BACKUP-RESTORE.md
data/       banco, backups e logs (não versionado)
```

## Próximos marcos (resumo da especificação)

1. **Fase 2** — coleta automática de vagas de fontes verificadas + agendamento às 18:00
2. **Fase 3** — IA para análise de compatibilidade (nunca inventa qualificações)
3. **Fase 4** — candidaturas automatizadas com confirmação por candidatura, portais verificados e CAPTCHA sempre encaminhado ao humano
4. **Fase 5** — lembretes de acompanhamento e consolidação

Regras permanentes: tentativa ≠ enviada; envio automático **desligado por padrão** e sempre confirmável; nada é declarado "suportado" sem verificação real.
