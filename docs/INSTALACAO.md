# Instalação e execução — JobPilot (Marco 1)

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

1. Abra a aplicação e vá em **Vagas → + Nova vaga**.
2. Preencha o título (obrigatório) e os demais campos opcionais.
3. Use **Iniciar candidatura** na página da vaga para acompanhar o processo.
4. Mude status pelos botões de transição — o backend recusa qualquer transição inválida (erro 409 explica o motivo).
5. "Enviada" pede a **data do envio**: é sempre uma declaração sua, nunca automática.

## 6. Configurações

Em **Configurações** é possível ajustar:

- Nome de exibição no dashboard.
- Fuso horário (formato IANA, ex.: `America/Sao_Paulo`) — usado apenas para exibir datas; o banco grava tudo em UTC.

Variáveis de ambiente opcionais (copie `.env.example` para `.env`):

| Variável        | Padrão                        | Descrição                                    |
| --------------- | ----------------------------- | -------------------------------------------- |
| `PORT`          | `3000`                        | Porta da API                                 |
| `HOST`          | `127.0.0.1`                   | Endereço de escuta (mantenha localhost)      |
| `DATABASE_PATH` | `<raiz>/data/jobpilot.sqlite` | Caminho do banco                             |
| `DATA_DIR`      | `<raiz>/data`                 | Pasta de dados (backups e logs ficam dentro) |

## 7. Migrações

Rodam automaticamente na inicialização. Manualmente:

```powershell
npm run db:migrate
```

As migrações são arquivos SQL versionados em `backend/migrations/` e são **idempotentes** (rodar de novo não altera nada).

## 8. Testes e build

```powershell
npm test        # 50 testes (backend); 100% offline, banco temporário por arquivo de teste
npm run build   # compila backend (tsc → backend/dist) e frontend (vite → frontend/dist)
```

## 9. Parar e limpar

- `Ctrl+C` encerra o processo.
- Para zerar os dados: feche a aplicação e apague a pasta `data/` (**cuidado**: apaga também os backups locais — copie-os antes).
- Dados de demonstração: o Marco 1 **não cria dados fictícios**; tudo que aparece na tela foi cadastrado por você (ou nos testes automatizados, que usam bancos temporários isolados).
