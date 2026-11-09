# Portais e candidatura assistida (Fase 4)

> **Decisão de 2026-11-08:** a Fase 4 é **candidatura assistida**, não envio
> automatizado. O JobPilot prepara os dados, mostra a checklist e abre a vaga;
> **a pessoa usuária revisa e clica em enviar**. Nenhum portal recebe
> submissão feita por bot.

## Por que não há envio automático

Os portais escolhidos têm condições de uso que vedam automação de candidatura
ou acesso por agentes automatizados. Automatizar o envio (ou o login) violaria
esses contratos, poderia restringir/banir a conta da pessoa e contrariaria a
regra do próprio projeto: automação só com portal verificado e condições de uso
compatíveis.

| Portal | Coleta de vagas | Envio pelo JobPilot | Situação contratual (verificada em 2026-11) |
| --- | --- | --- | --- |
| **Gupy** | Não (por enquanto) | **Manual** | Termos do candidato vedam copiar/agregar conteúdo e aplicar em nome de terceiros; a API pública é para empresas-cliente, não para candidatos. Candidatura assistida é permitida. |
| **LinkedIn** (candidatura simplificada) | Não | **Manual** | User Agreement §8.2 veda “bots ou outros métodos automatizados” de acesso. Enforcement rigoroso; risco de restrição da conta. |
| **Indeed** | Não | **Manual** | Termos vedam automatizar o “Indeed Apply” fora de vendors oficiais. A própria Indeed pausou o modo totalmente automático do “Apply for Me”. |
| **Glassdoor** | Não | **Manual** | Termos (rev. 2026) vedam robôs, spiders, scrapers e agentes automatizados. |

Fontes: páginas públicas de termos de uso de cada portal. Elas podem mudar;
**reverifique antes de qualquer mudança de comportamento**.

## O que o JobPilot faz hoje (fatias 1 a 3)

- Detecta o portal pela URL da vaga (`backend/src/domain/portals.ts`) e exibe o
  aviso correto. Todos os portais conhecidos são `manualOnly`.
- Monta o **kit de candidatura** (`GET /api/v1/jobs/:id/application-kit`):
  - dados de contato e links do perfil, resumo, habilidades e idiomas;
  - respostas padrão salvas no perfil;
  - resumo da última análise (score, lacunas, requisitos obrigatórios não
    atendidos);
  - checklist do que está pronto/faltando.
- Abre a vaga no portal em outra aba e oferece botão de copiar cada campo.
- **“Confirmo que enviei”** (`POST /api/v1/jobs/:id/application/mark-sent`)
  registra o envio **declarado** e a data. Não há chamada ao portal.
- **Portal e evidência** (migração 008): o envio grava o portal detectado
  (`portal_key`) e aceita um `evidence_url` opcional (confirmação, e-mail ou
  print). A evidência pode ser corrigida depois em `PATCH /applications/:id`,
  mas só quando a candidatura está `sent`.
- **Rascunho com IA** (`POST /api/v1/jobs/:id/application-draft`, migração 009):
  gera carta e respostas a partir do perfil, da vaga e das perguntas do
  formulário. Cada trecho precisa de **citação literal** do perfil (`cv`) ou da
  vaga (`job`); o sistema verifica e descarta o que não for comprovável. O
  rascunho não é salvo como candidatura, não é enviado e conta no teto diário
  de IA (tipo `draft`).

O kit é somente leitura e **não consome IA** (não gasta orçamento).

## O que o JobPilot nunca faz

- Fazer login automatizado ou guardar senha de portal.
- Resolver/contornar CAPTCHA, Cloudflare ou qualquer proteção anti-bot.
- Clicar em “enviar”, preencher formulário por automação ou enviar e-mail em
  nome da pessoa.
- Coletar vagas desses portais por scraping em massa.
- Inventar dados: campo ausente no perfil vira pendência na checklist.

## Coleta continua separada

A coleta diária das 18:00 segue com as fontes verificadas **Remotive** e
**Remote OK** (`docs/FONTES.md`). Incluir um novo portal de coleta exige
verificar termos, robots/limites e registrar a evidência antes de habilitar.

## Próximos passos da Fase 4

1. ~~**Rastreio de evidência**~~: concluído — portal e link de evidência ficam na candidatura.
2. ~~**Respostas sugeridas por IA (opcional)**~~: concluído — rascunho com citações verificadas e revisão humana.
3. **Portais com API oficial**: se algum dia houver um programa oficial para
   candidatos, reavaliar automação — hoje não é o caso dos quatro alvos.
