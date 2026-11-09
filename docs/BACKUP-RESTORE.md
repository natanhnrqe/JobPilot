# Backup e restauração — JobPilot (Marco 1)

## O que é feito no backup

- Cópia **consistente** do banco SQLite via `VACUUM INTO` (nunca uma cópia simples do arquivo com o WAL aberto).
- Validação **antes** de o backup ser considerado pronto:
  - `PRAGMA integrity_check` = `ok`;
  - presença de todas as tabelas do esquema;
  - `PRAGMA foreign_key_check` sem violações.
- Registro do backup na tabela `backups` e, também, **dentro do próprio arquivo** (o snapshot é autodescritivo: ao ser restaurado, ele se conhece).

Arquivo: `data/backups/jobpilot-AAAAAMMDD-HHMMSS-mmm.sqlite`.

**Segredos:** o backup contém apenas o banco. Chaves de `.env` nunca são incluídas (o Marco 1 não guarda credenciais). Quem quiser proteger o `.env` deve copiá-lo manualmente para um local seguro, fora do repositório. Nos marcos futuros, antes de existirem credenciais cifradas, a especificação exige documentar como preservar/recuperar a chave de criptografia — **a perda da chave significa perda irreversível dos dados cifrados**.

## Como criar

Pela **interface**: Configurações → "Criar backup agora".

Por linha de comando (a partir da raiz):

```powershell
npm run backup
```

Ou pela API: `POST /api/v1/backups`.

## Backup semanal automático (Fase 5)

Além do backup manual, é possível agendar um backup semanal validado no Windows.
Depois de `npm run build`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1
```

- Padrão: **domingo às 12:00** (horário local), no contexto do usuário atual.
- Outro dia/horário: `-Day Saturday -At "09:00"`.
- Remover: `-Uninstall`.
- Conferir: `Get-ScheduledTask -TaskName "JobPilot Backup" | Get-ScheduledTaskInfo`.
- Se o PC estiver desligado no horário, a tarefa roda na próxima vez que estiver disponível (`StartWhenAvailable`).

## Retenção

Os últimos **14** backups são mantidos. Excedentes (arquivo + registro) são removidos automaticamente na criação de um novo backup.

## Como restaurar

Pela **interface**: Configurações → lista de backups → **Restaurar** (pede confirmação).

Por linha de comando:

```powershell
npm run restore -- --file jobpilot-20261103-180722-597.sqlite --yes
```

Por API: `POST /api/v1/restore` com `{ "fileName": "...", "confirm": true }`.

### Etapas garantidas pela restauração

1. **Confirmação explícita** é obrigatória (`confirm: true`).
2. O arquivo escolhido é **validado** (integridade + esquema) antes de qualquer mudança.
3. Um **backup automático do estado atual** é criado (`kind = pre_restore`).
4. O banco é substituído e **revalidado** (integridade + FKs + contagens).
5. Se a revalidação falhar, o estado anterior é **recuperado automaticamente** (rollback) e o erro é reportado — o banco nunca fica no meio de um estado quebrado.
6. O registro de backups é reconciliado: o arquivo restaurado e o backup prévio continuam visíveis na interface.

### Proteções adicionais

- Nomes de arquivo são sanitizados (sem caminho relativo — evita acessar arquivos fora de `data/backups/`).
- Arquivo inválido/corrompido → restauração **cancelada** com erro 400 e banco intacto.
- Arquivo inexistente → 404.
- Enquanto a restauração ocorre, as demais operações não correm risco: as escritas do Marco 1 são síncronas e atômicas por transação, e a substituição do arquivo acontece em um único ponto do fluxo.

## Verificação (aceitação do Marco 1)

O fluxo completo é coberto por `backend/tests/integration/backup.api.test.ts`:

- backup criado e validado;
- restauração recupera exatamente os dados do momento do backup;
- sem confirmação → 400;
- arquivo inexistente → 404;
- arquivo corrompido → cancelamento e banco intacto;
- path traversal → 400;
- retenção de 14 backups.

## Recomendações ao usuário

1. Crie backup **antes** de restaurar qualquer coisa (a aplicação já faz um automaticamente, mas uma cópia extra em outro local é mais segura).
2. Copie periodicamente `data/backups/` para outro disco/pasta (ex.: OneDrive, pendrive).
3. Guarde o `.env` (se usar) separadamente — ele nunca é incluído em backup.
4. Teste a restauração depois do primeiro backup real para se familiarizar com o processo.
