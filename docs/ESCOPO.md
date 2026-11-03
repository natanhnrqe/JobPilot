# JobPilot — Documento de Escopo v1.1

**Status:** Escopo funcional validado; decisões técnicas pendentes.  
**Objetivo:** Desenvolver uma ferramenta pessoal de busca, gestão e candidatura automatizada a vagas de emprego.

## 1. Visão do produto

O JobPilot será uma aplicação local que centraliza todo o processo de busca por emprego, desde a descoberta de oportunidades até o acompanhamento dos processos seletivos.

Seu principal componente será um dashboard que permita visualizar todas as vagas encontradas, acompanhar o estado de cada candidatura, identificar pendências e consultar o histórico de atividades.

A aplicação utilizará inteligência artificial para analisar vagas, avaliar compatibilidade profissional, preparar candidaturas e executar tarefas automatizadas conforme regras configuradas pelo usuário.

O projeto deverá ser mantido em um repositório próprio, com código-fonte, dados e configurações sob controle do usuário.

## 2. Requisitos funcionais

### RF01 — Dashboard central

O sistema deverá apresentar:

- Total de vagas encontradas.
- Vagas novas e ainda não analisadas.
- Vagas prioritárias.
- Candidaturas preparadas, pendentes e enviadas.
- Entrevistas, ofertas e rejeições.
- Acompanhamentos pendentes.
- Histórico das últimas atividades.
- Estado da última busca automática e eventuais falhas.

Deverá permitir pesquisar, filtrar, ordenar e abrir os detalhes de cada vaga.

### RF02 — Busca automática

O sistema deverá pesquisar oportunidades de desenvolvimento de software, priorizando vagas de estágio e nível júnior.

A busca deverá utilizar múltiplas fontes confiáveis e tecnicamente viáveis, selecionadas durante a implementação.

Requisitos:

- Execução automática diária às 18h, no horário local.
- Execução manual sob demanda.
- Registro da fonte, URL original e data de descoberta.
- Normalização dos dados coletados.
- Detecção e tratamento de vagas duplicadas.
- Atualização de informações de vagas já conhecidas.
- Registro de erros por fonte.
- Resumo dos resultados de cada execução.

### RF03 — Perfil profissional

O usuário poderá importar seu currículo e complementar as informações com preferências pessoais.

O perfil deverá contemplar, conforme aplicável:

- Experiências profissionais.
- Formação acadêmica.
- Habilidades e tecnologias.
- Idiomas.
- Projetos e portfólio.
- Localização e modalidades de trabalho desejadas.
- Preferências de cargos e tipos de contratação.
- Pretensão salarial, quando informada.
- Respostas pessoais utilizadas em formulários de candidatura.

O sistema deverá permitir revisar e corrigir os dados extraídos do currículo.

A IA não poderá inventar qualificações, experiências ou informações pessoais.

### RF04 — Análise de compatibilidade

Cada vaga poderá ser analisada com base no perfil profissional e nas preferências configuradas.

A análise deverá:

- Identificar requisitos obrigatórios e desejáveis.
- Comparar os requisitos com as informações disponíveis no perfil.
- Produzir uma avaliação de compatibilidade acompanhada de justificativas.
- Identificar incompatibilidades e informações desconhecidas.
- Ajudar a priorizar oportunidades.

A pontuação deverá ser explicável e não poderá ser tratada como garantia de contratação.

### RF05 — Gestão de vagas e candidaturas

O sistema deverá distinguir o estado da oportunidade do estado da candidatura.

Exemplos de estados da oportunidade:

- Nova.
- Em análise.
- Priorizada.
- Descartada.
- Encerrada ou indisponível.

Exemplos de estados da candidatura:

- Não iniciada.
- Em preparação.
- Aguardando aprovação.
- Aprovada para envio.
- Enviando.
- Enviada, com confirmação registrada.
- Falha no envio.
- Entrevista.
- Oferta.
- Rejeitada.
- Retirada.

Os estados definitivos serão refinados na modelagem técnica.

Cada candidatura deverá possuir histórico de eventos, datas relevantes, observações e informações de acompanhamento.

### RF06 — Automação de candidaturas

O sistema deverá evoluir para preencher e enviar candidaturas automaticamente quando as regras configuradas pelo usuário forem satisfeitas.

A automação deverá:

- Funcionar apenas nos portais e formulários suportados.
- Utilizar os dados revisados do perfil profissional.
- Preparar respostas e documentos pertinentes.
- Aplicar regras de elegibilidade e autorização.
- Impedir envios duplicados sempre que possível.
- Registrar as ações executadas e seus resultados.
- Identificar falhas, bloqueios e etapas que exijam intervenção.
- Respeitar as restrições de acesso e as condições de uso das plataformas.

CAPTCHA, autenticação adicional e outras etapas que exijam intervenção humana deverão ser encaminhados ao usuário, quando aplicável, sem tentativas de contornar mecanismos de proteção.

O envio automático deverá ser controlado por regras explícitas. O usuário deverá conseguir desativá-lo, revisar os critérios e consultar o histórico das candidaturas enviadas.

### RF07 — Acompanhamento e lembretes

O sistema deverá identificar candidaturas que necessitem de acompanhamento.

Deverá permitir registrar:

- Data de envio.
- Data do último contato.
- Próxima data de acompanhamento.
- Prazo ou lembrete configurado.
- Resultado do acompanhamento.

Os prazos deverão ser configuráveis. Uma candidatura sem resposta não deverá ser considerada rejeitada automaticamente.

### RF08 — Execução e monitoramento

O sistema deverá registrar:

- Horário da última execução.
- Quantidade de vagas encontradas.
- Quantidade de duplicatas identificadas.
- Fontes consultadas e fontes que falharam.
- Candidaturas processadas.
- Erros e ações que exigem intervenção.

Deverá permitir executar tarefas manualmente e consultar os registros de execução pelo dashboard.

## 3. Requisitos não funcionais

- Interface web em React e TypeScript.
- Backend em Node.js e TypeScript.
- Execução inicial exclusivamente no computador local.
- Persistência em banco de dados SQLite.
- Nenhuma dependência obrigatória de um servidor de banco de dados 24 horas por dia.
- Código versionado em repositório Git próprio.
- Segredos e chaves de API fora do código-fonte.
- Backups dos dados persistidos.
- Testes automatizados para regras de negócio e fluxos críticos.
- Documentação para instalação, configuração, execução e recuperação de dados.
- Componentes separados por responsabilidade, com contratos explícitos entre os módulos.
- Possibilidade de futura migração da execução para a nuvem, sem tornar essa migração um requisito do MVP.

## 4. Stack proposta

| Componente | Tecnologia |
|---|---|
| Frontend | React + TypeScript |
| Backend | Node.js + TypeScript |
| Banco de dados | SQLite |
| Camada de acesso a dados | Prisma, após validar compatibilidade com o esquema necessário |
| Automação de navegador | Playwright |
| Agendamento inicial | Agendador de Tarefas do Windows |
| IA | API de modelo de linguagem, a selecionar |
| Testes | Vitest e testes de integração |
| Versionamento | Git |

A busca agendada deverá ser executada por um processo independente do dashboard. A aplicação não precisará permanecer aberta o dia inteiro, mas o computador deverá estar ligado e acordado no horário da execução.

## 5. Fases de implementação

### Fase 1 — Fundação e dashboard

- Estrutura do projeto.
- Esquema inicial do banco.
- API do backend.
- Cadastro e edição de vagas.
- Filtros e visualização de detalhes.
- Gestão de status e histórico.
- Perfil profissional.
- Testes e backup inicial.

### Fase 2 — Coleta automática

- Seleção e implementação das fontes.
- Normalização e deduplicação.
- Agendamento diário às 18h.
- Execução manual.
- Registro de falhas e monitoramento.

### Fase 3 — Inteligência e priorização

- Importação e extração de currículo.
- Análise de compatibilidade.
- Classificação de prioridades.
- Preparação de respostas e documentos.
- Interface de revisão das recomendações.

### Fase 4 — Candidaturas automatizadas

- Escolha do primeiro portal suportado.
- Preenchimento automatizado.
- Regras de elegibilidade e autorização.
- Prevenção de envios duplicados.
- Registro de resultados e recuperação de falhas.
- Ativação gradual do envio automático controlado.

### Fase 5 — Acompanhamento e consolidação

- Lembretes de acompanhamento.
- Painel de pendências.
- Histórico consolidado.
- Revisão de segurança e testes de regressão.
- Documentação e preparação para uso contínuo.

## 6. Critérios gerais de conclusão

O JobPilot será considerado funcional quando conseguir:

1. Persistir e organizar vagas sem perder o histórico entre execuções.
2. Encontrar oportunidades por meio das fontes implementadas.
3. Executar buscas agendadas e informar seu resultado.
4. Identificar duplicatas de maneira consistente.
5. Analisar oportunidades com base em um perfil profissional revisado.
6. Manter estados e histórico de candidaturas confiáveis.
7. Preparar candidaturas e executar envios autorizados nos portais suportados.
8. Sinalizar falhas sem registrar incorretamente uma candidatura como enviada.
9. Gerar lembretes para acompanhamentos pendentes.
10. Permitir que o usuário faça backup, restaure os dados e execute a aplicação de forma independente.

## 7. Princípio de desenvolvimento

Agentes de programação poderão implementar módulos do sistema, mas deverão trabalhar a partir de requisitos, contratos e critérios de aceitação definidos.

O projeto não deverá ser considerado concluído apenas porque o código foi gerado. Cada entrega deverá ser executada, testada e revisada antes da integração.

A prioridade é construir uma ferramenta pessoal confiável, utilizável e sustentável, com o dashboard como centro da experiência e a automação como mecanismo para reduzir trabalho repetitivo.