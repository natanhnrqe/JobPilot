# Instalação e execução — JobPilot

Guia para rodar a aplicação no Windows a partir de um repositório limpo.

## 1. Pré-requisitos

| Item    | Versão mínima           | Verificação      |
| ------- | ----------------------- | ---------------- |
| Node.js | 22.5 (recomendado 24.x) | `node --version` |
| npm     | 10.x                    | `npm --version`  |

O banco de dados é o módulo **nativo** `node:sqlite` — não há servidor de banco nem compilação de dependências nativas.

## 2. Instalar dependências

Na raiz do repositório:

```powershell
npm install
```

Isso instala os workspaces `backend` e `frontend`. Nenhum arquivo `.env` é obrigatório.

## 3. Rodar em modo desenvolvimento

```powershell
npm run dev
```

- Backend: `http://127.0.0.1:3000` (API)
- Frontend: `http://localhost:5173` (abra este no navegador; `/api` é encaminhado ao backend pelo Vite)

O backend reinicia sozinho ao alterar arquivos (`tsx watch`).

## 4. Rodar em modo "produção local" (um processo)

```powershell
npm run build
npm start
```

O backend passa a servir a interface compilada em **http://127.0.0.1:3000**.

## 5. Primeiro uso

1. Abra a aplicação e vá em **Vagas → + Nova vaga** (cadastro manual).
2. Preencha o título (obrigatório) e os demais campos opcionais.
3. Use **Iniciar candidatura** na página da vaga para acompanhar o processo.
4. Mude status pelos botões de transição — o backend recusa qualquer transição inválida (erro 409 explica o motivo).
5. "Enviada" pede a **data do envio**: é sempre uma declaração sua, nunca automática.

### Cadastro com IA (opcional)

1. Vá em **Vagas → + Cadastrar com IA**.
2. Cole a descrição da vaga (ou informe a URL) e clique em **Extrair com IA**.
3. Confira a **prévia editável**: a IA pode deixar campos vazios quando não encontra a informação — nada é inventado e nada é salvo antes de você clicar em **Confirmar e salvar vaga**.
4. Se aparecer "possível duplicata", abra a vaga indicada e decida você mesmo.

Sem chave de IA configurada a página avisa e o cadastro manual continua disponível. Detalhes em [`docs/IA.md`](IA.md).

## 6. Configurações

Em **Configurações** é possível ajustar:

- Nome de exibição no dashboard.
- Fuso horário (formato IANA, ex.: `America/Sao_Paulo`) — usado apenas para exibir datas; o banco grava tudo em UTC.

Variáveis de ambiente opcionais (copie `.env.example` para `.env` na raiz; o backend lê esse arquivo e dá precedência ao ambiente real):

| Variável        | Padrão                        | Descrição                                    |
| --------------- | ----------------------------- | -------------------------------------------- |
| `PORT`          | `3000`                        | Porta da API                                 |
| `HOST`          | `127.0.0.1`                   | Endereço de escuta (mantenha localhost)      |
| `DATABASE_PATH` | `<raiz>/data/jobpilot.sqlite` | Caminho do banco                             |
| `DATA_DIR`      | `<raiz>/data`                 | Pasta de dados (backups e logs ficam dentro) |
| `AI_API_KEY`    | *(sem chave)*                 | Habilita o cadastro assistido por IA         |
| `AI_BASE_URL`   | `https://api.openai.com/v1`   | Endpoint compatível com OpenAI               |
| `AI_MODEL`      | `gpt-4o-mini`                 | Modelo usado na extração                     |
| `AI_TIMEOUT_MS` | `60000`                       | Tempo máximo por chamada de IA               |

A chave de IA é opcional: sem ela, apenas a extração assistida fica indisponível (o restante funciona). Veja [`docs/IA.md`](IA.md) para custos, testes offline e comportamento em falhas.

## 7. Migrações

Rodam automaticamente na inicialização. Manualmente:

```powershell
npm run db:migrate
```

As migrações são arquivos SQL versionados em `backend/migrations/` e são **idempotentes** (rodar de novo não altera nada).

## 8. Testes e build

```powershell
npm test        # 139 testes (backend); 100% offline, banco temporário por arquivo de teste
npm run build   # compila backend (tsc → backend/dist) e frontend (vite → frontend/dist)
```

## 9. Coleta de vagas (CLI)

Com o app fechado ou aberto, a coleta pode rodar direto no banco:

```powershell
npm run collect
```

- Usa as fontes verificadas em [`FONTES.md`](FONTES.md) (hoje: Remotive) e grava as vagas novas pelo mesmo caminho do cadastro manual.
- Registra a execução em `search_runs` + `execution_logs` e grava o resumo em `data/last-run.json`.
- Duas execuções simultâneas: a segunda é marcada como `skipped` (lock em `data/.lock`).
- Saída: `0` = sucesso/parcial; `1` = falha total.
- O agendamento automático às 18:00 será configurado na próxima etapa (o PC precisa estar ligado e com rede).

## 10. Parar e limpar

- `Ctrl+C` encerra o processo.
- Para zerar os dados: feche a aplicação e apague a pasta `data/` (**cuidado**: apaga também os backups locais — copie-os antes).
- Dados de demonstração: o Marco 1 **não cria dados fictícios**; tudo que aparece na tela foi cadastrado por você (ou nos testes automatizados, que usam bancos temporários isolados).
