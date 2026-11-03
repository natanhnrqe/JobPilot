# JobPilot

Aplicação **local** para cadastrar, organizar e acompanhar vagas de emprego e candidaturas — Marco 1: dashboard com vagas e candidaturas **manuais**, status validados e histórico, 100% offline.

> 📘 Especificação completa: [`docs/ESPECIFICACAO-TECNICA.md`](docs/ESPECIFICACAO-TECNICA.md) · Escopo funcional: [`docs/ESCOPO.md`](docs/ESCOPO.md)

## O que está implementado (Marco 1)

- ✅ Cadastro, listagem, busca, filtros, edição, exclusão (lógica) e restauração de **vagas**
- ✅ **Candidaturas** 1:1 com a vaga, com status próprio e data de envio **declarada pelo usuário**
- ✅ Máquinas de estado separadas para vaga e candidatura, **validadas no backend** (transições inválidas → 409)
- ✅ **Histórico de eventos** (criação, mudanças de status, exclusões, notas) gravado na mesma transação
- ✅ **Notas** vinculadas à vaga ou à candidatura (criar, editar, excluir)
- ✅ **Dashboard** com contadores reais do banco e atividade recente
- ✅ **Backup e restauração** do banco SQLite com validação de integridade e rollback automático
- ✅ Configurações locais (nome de exibição, fuso horário)
- ✅ 50 testes automatizados (domínio, API, persistência, backup/restore) — 100% offline

**Não implementado neste marco** (por design): busca automática de vagas, IA, agendamento, Playwright/automação de envio, upload de currículo e lembretes. As vagas são cadastradas manualmente.

## Requisitos

- **Node.js ≥ 22.5** (testado no Node 24) — usa o módulo nativo `node:sqlite`
- Windows (testado) — deve funcionar também em Linux/macOS por não ter dependências nativas
- Navegador atual

## Instalação

```powershell
# na raiz do repositório
npm install
```

Nenhum `.env` é necessário (há padrões sensatos; veja `.env.example` para sobrescrever porta/host/caminhos).

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
