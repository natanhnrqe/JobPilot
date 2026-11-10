# Revisão de segurança e regressão — JobPilot (Fase 5.4)

Revisão feita em **2026-11-08**, cobrindo as fases 1–5. O objetivo é confirmar
que o JobPilot continua **local, sem segredos versionados, sem automação de
portais** e que os fluxos críticos têm teste de regressão.

## Checklist

| #   | Item                                      | Evidência / verificação                                                                 | Status |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| 1   | Nenhum segredo ou banco versionado        | `git ls-files` não lista `.env`, `data/`, `*.sqlite`, `*.key` ou `*.pem`                 | ✅     |
| 2   | API escuta só em localhost por padrão     | `HOST` padrão `127.0.0.1` em `backend/src/config/index.ts`                              | ✅     |
| 3   | Sem automação de candidatura/login/CAPTCHA | nenhuma rota `/automation/*`, `/send-attempts` ou `/portals`; decisão em `PORTAIS.md`  | ✅     |
| 4   | IA nunca escreve direto no banco          | saída validada por zod + sanitização; gravação só após confirmação humana               | ✅     |
| 5   | Teto diário de IA bloqueia antes de gastar | `429 AI_BUDGET_EXCEEDED` coberto em `aiUsage.api.test.ts`                               | ✅     |
| 6   | Arquivo original do CV não é retido       | apenas `raw_cv_text` e dados revisados; sem upload persistido                           | ✅     |
| 7   | “Enviada” é sempre declaração humana      | `mark-sent`/`PATCH` exigem ação explícita; nenhum código acessa o portal                | ✅     |
| 8   | Exportação não vaza segredos              | exporta apenas colunas do banco local; CSV neutraliza fórmulas de planilha              | ✅     |
| 9   | Notificação desktop não derruba a UI      | falha de permissão/exibição só gera `console.warn`; dashboard segue funcionando         | ✅     |
| 10  | Backup e restauração validados            | integridade + FKs + rollback automático; `backup.api.test.ts` (inclui path traversal)   | ✅     |
| 11  | Busca por URL protegida contra SSRF       | bloqueio de IPs privados/esquemas, limites de tempo/tamanho; `safeFetch.test.ts`        | ✅     |
| 12  | Exclusão preserva histórico               | soft delete; exportação inclui `deleted_at`                                             | ✅     |
| 13  | Lembretes não alteram status sozinhos     | `reminders.api.test.ts`; conclusão é ação do usuário                                    | ✅     |
| 14  | Regressão completa                        | **303 testes / 34 arquivos**; `lint`, `format:check` e `build` verdes                   | ✅     |

## Comandos usados na revisão

```powershell
# da raiz do repositório
npm test -- --run          # backend (ou: cd backend; npm test -- --run)
npm run lint
npm run format:check
npm run build

# segredos e dados versionados
git ls-files | Select-String -Pattern '\.env$|^data/|\.sqlite$|\.key$|\.pem$'
git grep -n -E "sk-[A-Za-z0-9]{16,}" -- . ':!package-lock.json'
```

## Riscos residuais e limites conhecidos

- **Sem autenticação de usuário**: a API é local e escuta em `127.0.0.1`. Não
  exponha a porta na rede; se precisar, use um proxy com autenticação.
- **Notificação desktop**: depende de permissão do navegador e de a aba/página
  estar aberta para o dashboard carregar. Sem permissão, o painel de pendências
  continua sendo o canal principal.
- **IA opcional**: quando configurada, o texto do CV e da vaga é enviado ao
  provedor escolhido. Isso está documentado em [`IA.md`](IA.md); sem chave, o
  restante do app funciona.
- **Portais-alvo**: Gupy, LinkedIn (candidatura simplificada), Indeed e
  Glassdoor vedam bots/automação. O JobPilot apenas prepara dados e registra o
  envio declarado; ver [`PORTAIS.md`](PORTAIS.md).
- **Backup**: os arquivos ficam em `data/backups/` e não são sincronizados
  automaticamente. Copie-os para outro local (ver [`BACKUP-RESTORE.md`](BACKUP-RESTORE.md)).

## Referências

- [`PORTAIS.md`](PORTAIS.md) — limites por portal e decisão de candidatura assistida
- [`IA.md`](IA.md) — dados enviados ao provedor, orçamento e falhas
- [`FONTES.md`](FONTES.md) — fontes verificadas e ToS/robots
- [`BACKUP-RESTORE.md`](BACKUP-RESTORE.md) — validação, retenção e rollback
