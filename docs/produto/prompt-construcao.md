---
atualizado: 2026-10-15
dono: Vinicius André
---

# JiraIA: prompt de construção

Prompt para entregar a quem vai codar o JiraIA (pessoa usando Claude Code ou outro agente de
codificação) no repositório de código da Let's. Copie tudo entre as linhas `=====` e cole como
primeira mensagem da sessão. Junto, copie para a pasta `docs/produto/` do repositório de
código estes arquivos: `README.md`, `escopo-mvp.md`, `arquitetura.md` e `plano.md` desta pasta,
mais `decisoes/2026-10-15-jiraia-referencia-funcional.md`.

=====

# Missão
Você vai construir o **JiraIA**: a plataforma interna da Let's (empresa brasileira de
tecnologia logística) para gestão de trabalho, que substitui o Jira, e de conhecimento, que
substitui o Confluence. A plataforma é **nativa em IA**: agentes de IA são membros do time,
ao lado das pessoas.

- **Prazo do MVP em produção:** 30/11/2026.
- **Condição de pronto:** as áreas da Let's conseguem largar o Jira e o Confluence sem perder o
  que usam hoje.

As specs de produto estão em `docs/produto/`. Leia todas antes de escrever código. A ordem de
prioridade é:
1. `escopo-mvp.md`: matriz de funcionalidades. Itens **M** são obrigatórios.
2. `arquitetura.md`: stack, modelo de domínio, agentes, MCP e migração.
3. `plano.md`: cronograma e critérios de pronto do corte.
4. `README.md`: contexto, riscos e perguntas em aberto.
5. A decisão de clean room, em `docs/produto/`.

Se este prompt e as specs divergirem, **as specs valem**. Se algo estiver ambíguo, escolha a
opção mais simples que atenda à spec, registre a escolha como ADR em `docs/adr/` e siga. Não
pare para perguntar o que dá para decidir com bom senso.

# Padrão da casa: LetsDelivery/uselets
O JiraIA segue as ferramentas, os frameworks e as convenções do repositório
`LetsDelivery/uselets` (outro produto nativo em IA da Let's, já validado pelo time de
desenvolvimento). Antes de codar, leia o `AGENTS.md`, o `CONTEXT.md`, o `docs/STRUCTURE.md` e as
ADRs de arquitetura do uselets (0001, 0002, 0003, 0004, 0005, 0006, 0010, 0027, 0038, 0102, 0107,
0114). O que este prompt não definir segue o uselets. O JiraIA só se afasta dele onde a spec
exige algo que o uselets não tem, e cada desvio vira uma ADR.

- **Idioma:** código, comentários, commits, ADRs, logs e erros em **inglês**. Só o texto de
  interface é pt-BR. As specs de produto em `docs/produto/` continuam em pt-BR.
- **Docs de engenharia:** ADRs em `docs/adr/NNNN-slug.md`, no formato do uselets. Glossário do
  domínio em `CONTEXT.md`.
- **Pacotes base:** copie do uselets `packages/http`, `packages/events`, `packages/logger`,
  `packages/authorization` e `packages/testing`, com uma nota de origem, e adapte ao domínio. É
  código da própria Let's, então o clean room não se aplica a ele.

# Regra inegociável: clean room
O JiraIA é código 100% da Let's.
- **Nunca** abra, clone, leia, copie ou adapte código, componentes, ícones, ilustrações, textos
  de interface ou traduções do **Plane** (makeplane/plane, AGPL-3.0). O mesmo vale para
  qualquer outro projeto com licença copyleft (GPL, AGPL, SSPL).
- Construa só a partir das specs em `docs/produto/`.
- Dependências só com licença permissiva: MIT, ISC, BSD, Apache-2.0 ou PostgreSQL. Pacotes da
  própria Let's (`@uselets/*`) são permitidos. O uselets não checa licença (o gate `audit` dele
  só olha vulnerabilidades), então o JiraIA acrescenta um gate `check:licenses` em
  `infra/ci/`, no mesmo estilo dos outros, que **falha** com copyleft.
- Não use nomes, termos ou marcas de terceiros na interface. A interface fala de **cards,
  espaços, páginas e agentes**.

# Stack (decidida em 2026-10-15, padrão uselets)
TypeScript de ponta a ponta, serverless na AWS, em monorepo com **bun workspaces** (sem Turbo).

**Herdado do uselets, sem mudança:**

| Camada | Escolha |
|---|---|
| Runtime e pacotes | bun 1.4.3 (versões exatas, `bunfig.toml`), Node 24.18 (`.tool-versions`), TypeScript 5.9 strict |
| API | TypeScript puro, sem framework. Uma **Lambda roteadora por contexto** atrás de API Gateway HTTP API, com `defineRoute` (`requires`, `schemas`, `responds`) de `packages/http`. Lambdas extras só para consumidores assíncronos |
| Build | `tsc` gerando `.js` um por arquivo (legível no console da Lambda), `nodejs24.x`, dependências numa layer com lista explícita |
| Contrato | zod 4. OpenAPI 3.1 gerado por `bun run contracts` (`z.toJSONSchema`). O front consome com `openapi-typescript` e `openapi-fetch` |
| Eventos e fila | Um barramento EventBridge `jiraia-<env>` com uma fila SQS e uma DLQ **por consumidor** (`packages/events`) |
| Agenda | Evento `Schedule` do SAM disparando Lambdas de varredura |
| Login | **Google** (Google Identity Services). O API Gateway valida o ID token do Google; o serviço admite só e-mail verificado do Workspace `@uselets.com` (claim `hd`). Quem é do domínio entra; o convite dá papéis antes do primeiro login. Sem Cognito (ADR-0005 do repo). Local: `x-local-user: <email>` |
| Autorização | Decidida dentro do serviço (`packages/authorization`), nunca só no gateway. Papéis são presets de permissão copiados para a conta |
| Agentes e tokens | Agente e integração são **usuários que não são pessoas** (como na ADR 0038 do uselets) |
| Arquivos | S3 com URL pré-assinada. Local: stub com formato de S3 |
| Infra | SAM/CloudFormation por serviço. Base em `infra/platform`, `edge`, `web`. Config lida do SSM no deploy (`{{resolve:ssm:...}}`), nunca em tempo de execução |
| CI e deploy | GitHub Actions no runner CodeBuild. CodePipeline: build único → dev → aprovação → produção |
| Testes | Backend: `bun test` com `*.unit.test.ts` e `*.integration.test.ts`, nunca fora do localhost, APIs externas com MSW. Front: Vitest. E2E: Playwright |
| Qualidade | Biome 2.5.8, husky (pre-commit: biome + tsc), commitlint com escopo obrigatório, gitleaks e os gates de `test:ci` do uselets (handlers, config, timezone, zod, http, prose, contracts, audit) |
| Observabilidade | Logger e métricas do Powertools (`packages/logger`), alarmes no CloudWatch, X-Ray |
| E-mail | SES v2 com templates próprios (`packages/email`) |

**Acrescentado pelo JiraIA** (o uselets não tem; cada item vira ADR):

| Camada | Escolha | Por quê |
|---|---|---|
| Banco | **Aurora PostgreSQL Serverless v2 + pgvector**, acessado pela **RDS Data API** (a Lambda fica fora de VPC, como na ADR 0005 do uselets). Drizzle ORM com o driver da Data API e migrações versionadas. Local: Postgres com pgvector no Docker, em portas dev e teste separadas, como no uselets | Filtros por qualquer campo, busca textual, busca semântica, "mudou para o estado X depois de D" e board de 20 mil cards em menos de 2 s. O DynamoDB em tabela única não atende. Desvia da ADR 0002 do uselets |
| Tempo real | **API Gateway WebSocket + Lambda** (padrão serverless da casa, sem containers). Yjs como CRDT, com as atualizações persistidas no Postgres e a presença (cursores) retransmitida pela conexão | Coedição de páginas (5.3) |
| Editor | TipTap (ProseMirror), MIT | Editor rico de páginas |
| IA | `@anthropic-ai/sdk`, encapsulado atrás de uma interface no `container.ts`, com modelo configurável por agente | Loop de uso de ferramentas. O `@typesafe-ai/sdk` do uselets só classifica texto |
| MCP | `@modelcontextprotocol/sdk` em modo Streamable HTTP sem estado, numa Lambda | Rotinas e Claude Code lendo e propondo no JiraIA |
| Slack | Webhook de entrada via `createHttpClient` | Automação REQ → PRD |
| Front | **JavaScript puro** (TypeScript compilado, sem framework), Vite, `openapi-fetch`. Design pela skill `design-principles`, vidro só no que flutua (ADR-0006 do repo) | Decisão de 2026-10-15: telas simples e carga leve. Sai o React do uselets |
| Licenças | Gate `check:licenses` | Clean room |

Estrutura (espelha o uselets):

```
services/   um por contexto: work (espaços, cards, visões), pages, agents,
            automation, search, migration — cada um com template.yml,
            src/router.ts, routes.ts, container.ts, src/<aggregate>/{schemas,repositories,services}
packages/   http, events, logger, authorization, testing (copiados do uselets), db (Drizzle)
apps/web    painel
infra/      platform, edge, web, local, ci, contracts, build, layers, deploy, pipeline
docs/       adr/, produto/ (specs em pt-BR), etapas/
```

Os limites exatos de cada serviço são decididos na Etapa 1 e registrados em ADR.

Sem segredos no código. Config pelo SSM e `.env.sample` documentado para o ambiente local.
`bun run up` sobe o ambiente local completo (containers, schema, seed, API em `local:serve` e
painel), com dados de exemplo.

# Identidade visual (Max / Let's)
- **Componentes, cores e tipografia:** tokens em `apps/web/src/styles/tokens.css` (vermelho do Max
  como único acento, Inter, grade de 4px), seguindo a skill `design-principles`. Vidro
  (glassmorfismo) só no que flutua: barra lateral, cabeçalho, diálogos, menus e toasts (ADR-0006).
- **Ícones:** Tabler Icons (MIT). Outline para UI, Filled para status, 24px.
- **Tema:** claro e escuro.
- **Idioma:** interface 100% em **pt-BR**. Datas no fuso America/Sao_Paulo.

# Princípios de produto
1. **Agentes propõem, pessoas aprovam.** Toda alteração de um agente vira uma **Proposta**
   (diff antes e depois, autor, motivo). Ela só é aplicada com aprovação humana. O modo
   "executar" vale só para ações liberadas explicitamente pelo administrador do espaço.
   Proposta aplicada pode ser revertida.
2. **API primeiro.** Web, agentes, MCP e automações usam a mesma API, com as mesmas regras de
   permissão. A autorização mora na API, nunca só no front.
3. **Configurável sem código.** Tipos de card, fluxos, campos, formulários e automações são
   configuração de cada espaço. Cada área monta o seu.
4. **Tudo auditado.** Toda escrita gera evento de auditoria: ator (pessoa ou agente), entidade,
   campo, antes, depois e data. Esse mesmo registro alimenta o histórico do card.
5. **Chaves estáveis.** Cards têm chave `PROJ-N` (ex.: `REQ-123`), preservada na migração e
   ao mover um card. A chave antiga redireciona.

# Modelo de domínio (resumo; detalhe em arquitetura.md)
Organização → Espaço → Card. O Espaço é o "espaço" do Jira atual: chave, tipo, líder e cards (ADR-0007
do repo). Pessoa e Agente são **Membros**, com papel por espaço: admin, membro, convidado ou leitor.

- **Card:**
  - Atributos: tipo, título, descrição (JSON do editor), estado, responsável, relator,
    prioridade (5 níveis), labels, data limite, estimativa e campos customizados.
  - Relações: pai e filhos, e vínculos tipados (relaciona, bloqueia, duplica, entrega,
    incidente).
  - Interação: comentários, reações, anexos e observadores.
- **Estado:** pertence ao espaço e a um grupo (não iniciado, em andamento, concluído,
  cancelado). O nome é livre e aceita emoji.
- **Campo customizado:** texto, número, data, seleção única, seleção múltipla, pessoa ou URL,
  vinculado a tipos de card.
- **Visão salva:** filtros, agrupamento e layout (board, lista, backlog). Pode ser pessoal ou
  do espaço.
- **Formulário:** mapeia campos para um tipo de card. Aplica labels automáticas.
- **Automação:** gatilho (card criado, mudou de estado, campo mudou, agenda) → condições →
  ações (criar card em outro espaço, vincular, alterar campo, comentar, notificar Slack,
  webhook, acionar agente).
- **Página:**
  - Organização: árvore por espaço.
  - Edição: documento Yjs, versões, comentários.
  - Vínculos: menções a pessoas e cards, card embutido com estado ao vivo.
- **Agente:** dono, instruções, ferramentas permitidas, escopo, gatilhos, modo e orçamento.
- **Execução:** entrada, passos, saída, custo e status.
- **Proposta:** diff, status (pendente, aplicada, recusada, revertida) e quem aprovou.
- **Notificação**, **EventoDeAuditoria**, **Webhook**, **TokenDeAPI**.

# Como trabalhar
- **Fatias verticais.** Cada etapa entrega banco, API, interface e testes funcionando de ponta
  a ponta. Nada de "camada inteira primeiro".
- **Antes de cada etapa:** escreva em `docs/etapas/<n>.md` o que vai entregar e os critérios
  de aceite tirados de `escopo-mvp.md`.
- **Ao final de cada etapa:**
  - `bun run test:ci` verde, incluindo `check:licenses`;
  - `bun run up` funcionando, com a rota chamada no `local:serve` e o corpo e o log lidos
    ("suíte verde não é funcionalidade funcionando", regra do uselets);
  - roteiro de demo de 5 minutos em `docs/etapas/<n>.md`;
  - commit e PR, como no uselets: conventional commits com escopo do módulo, `master` só por
    PR com uma aprovação, `ci-ok` verde e squash.
- **Testes:** regras de domínio e permissões com teste de unidade; endpoints com teste de
  integração; um teste E2E por fluxo principal. Toda função nova ganha teste e toda correção
  ganha teste de regressão.
- **Performance:** board e página abrem em menos de 2 s com 20 mil cards e 2 mil páginas.
  Crie um script de seed com esse volume.
- **O que depende de acesso externo** (SSO real, conta de nuvem, token da Atlassian, chave da
  Anthropic): deixe atrás de variáveis de ambiente, com dublês nos testes. Liste em
  `docs/pendencias-externas.md`.

# Etapas
Cada etapa termina com os critérios abaixo atendidos.

**Etapa 1. Fundação**
- Monorepo no padrão uselets (bun, Biome, husky, commitlint, gates, pacotes base copiados), CI,
  ambiente local (`bun run up`), Postgres e migrações Drizzle, stack base em SAM, login com Google
  com `x-local-user` no local, organização, espaços, membros e papéis, auditoria.
- ADRs de abertura: limites dos serviços, Postgres via Data API, tempo real via WebSocket e
  herança do padrão uselets.
- **Pronto quando:** um admin cria o espaço `REQ`, convida pessoas com papéis, e um leitor não
  consegue alterá-lo (teste de API).

**Etapa 2. Cards e board**
- Tipos de card, fluxos configuráveis com grupo de estado e emoji, campos padrão e
  customizados, subtarefas, vínculos tipados, comentários com menção, anexos, histórico,
  observadores.
- Board kanban com arrastar e soltar e raias, lista com colunas, backlog ordenável.
- **Pronto quando:** dá para recriar o fluxo do PRD (10 estados, de Backlog a Bloqueado) e
  operar um card de ponta a ponta com histórico completo.

**Etapa 3. Filtros, busca e ações em massa**
- Filtros por todos os campos, incluindo "mudou para o estado X depois de D". Visões salvas,
  busca textual global, navegação pela chave e ações em massa.
- **Pronto quando:** cada JQL da lista abaixo tem uma visão salva equivalente que retorna o
  mesmo conjunto em um seed de teste.
  - REQ aguardando triagem
  - Discovery em andamento
  - Bloqueados
  - Lançados nos últimos 7 dias
  - Por label de OKR

**Etapa 4. Páginas**
- Árvore por espaço. Editor TipTap com títulos, listas, tarefas, citação, destaque, código,
  tabela, imagem, anexo, divisor, comando "/" e atalhos markdown.
- Coedição em tempo real (Yjs sobre API Gateway WebSocket + Lambda), versões com comparação e
  restauração,
  comentários em página e em trecho.
- Menção a pessoas e cards, card embutido com estado ao vivo, criar card a partir de trecho
  selecionado.
- **Pronto quando:** duas pessoas editam a mesma página ao mesmo tempo sem perda, e uma versão
  antiga é restaurada.

**Etapa 5. Entrada, automação e notificação**
- Formulários públicos internos, motor de automações (EventBridge + SQS), integração Slack (incoming
  webhook ou app), notificações in-app e e-mail consolidado, webhooks de saída assinados com
  retentativa, tokens de API.
- **Pronto quando:** um envio do formulário do REQ cria o card com a label `business-form`, e
  ao mover para "🚨 Itens priorizados" uma automação cria a Oportunidade no PRD, vincula as
  duas e publica no Slack. Concluir o card do TEC atualiza o PRD vinculado.

**Etapa 6. Agentes, busca semântica e MCP**
- Runtime de agentes:
  - o loop de uso de ferramentas da API do Claude chama a própria API do JiraIA;
  - permissões e escopo do agente valem;
  - há limite de orçamento por agente.
- Telas: cadastro do agente, execuções e caixa de propostas com diff, aprovar, recusar e
  reverter.
- Embeddings em pgvector, busca semântica e o agente "Pergunte ao JiraIA", que sempre cita os
  cards e as páginas usados como fonte.
- Assistente no editor: escrever, resumir, reescrever e traduzir.
- **Servidor MCP:** buscar, ler card e página, listar estados e campos, consultar com filtro
  estruturado, comentar e criar proposta. **Sem** ferramenta de escrita direta: escrita é
  sempre por proposta.
- **Catálogo inicial**, com as instruções de cada agente em `packages/agents/`:

  | Agente | Gatilho | O que faz |
  |---|---|---|
  | Triagem | Card criado no REQ | Sugere label de OKR (`okr-novos-clientes`, `okr-expansao-base`, `okr-saude-escala`, `okr-nenhum`), aponta duplicadas e falta de informação |
  | Spec | Entrar em "Especificação" no PRD | Propõe a descrição nas seções Contexto, Problema, Oportunidade, Escopo, Fora do Escopo, Regras de Negócio e Critérios de Aceitação |
  | Histórias | Entrar em "Em refinamento" | Propõe histórias para o TEC com critérios de aceite "Dado, quando, então" |
  | Release | Agenda semanal | Propõe uma página de release note com os cards lançados nos últimos 7 dias |

- **Pronto quando:** um agente acionado por menção gera uma proposta que fica pendente, é
  aprovada, aparece no histórico como "Agente X, aprovado por Y" e pode ser revertida.

**Etapa 7. Builder de espaço**
- A pessoa descreve o processo da área em linguagem natural. O agente propõe, como uma única
  proposta revisável, os tipos de card, o fluxo, os campos, o formulário de entrada, as
  automações e uma página "Como funciona este espaço".
- **Pronto quando:** a descrição "o Jurídico recebe pedidos de contrato pelo formulário,
  revisa, negocia com a outra parte, colhe assinatura e arquiva" gera um espaço utilizável
  depois da aprovação.

**Etapa 8. Migração**
- Importadores via API REST do Jira Cloud e do Confluence Cloud (token em variável de
  ambiente):
  - Jira: espaços (antigos projetos), tipos, estados, campos customizados, cards, comentários, anexos, vínculos
    e labels, **preservando as chaves**;
  - Confluence: espaços, árvore, conteúdo convertido para o formato do editor, anexos e
    imagens;
  - usuários mapeados por e-mail.
- Modo ensaio (dry-run), relatório de conferência com contagens por espaço do Jira e do Confluence, e
  importação incremental para o corte.
- **Pronto quando:** o importador roda contra um mock das APIs da Atlassian nos testes e gera
  o relatório de conferência.

**Etapa 9. Endurecimento**
- Seed de volume e meta de performance. Backup e restauração documentados e testados.
  Monitoramento de erros. Revisão de permissões (teste de autorização para cada endpoint).
  Guia rápido de uso como página-semente.
- Checklist do corte, conforme a seção "Critérios de pronto" de `plano.md`.

# Fora do escopo (não construa agora)
- Sprints com burndown, roadmap, Gantt e calendário.
- Time tracking.
- Dashboards customizados.
- Service desk com SLA.
- Visões de product discovery.
- Boards públicos, acesso externo e apps móveis.
- Integrações além do Slack.
- Builder visual de fluxos multiagente.

Registre ideias nessas áreas em `docs/backlog-futuro.md`.

# Segurança e LGPD
- Autorização em toda rota.
- Uploads validados por tipo e tamanho.
- Sanitização de HTML.
- Rate limit nos tokens de API.
- Segredos só por ambiente.
- O agente nunca enxerga dado fora do seu escopo. O contexto enviado ao modelo é montado pela
  API com as permissões do agente.
- Não registre conteúdo de cards ou páginas em logs de aplicação.

# Primeira resposta esperada
Antes de codar:
1. Leia `docs/produto/` e o estado atual do repositório.
2. Responda com:
   - um resumo de 10 linhas do que entendeu;
   - o plano da Etapa 1, com arquivos e pacotes;
   - riscos que enxerga no prazo.
3. Em seguida, comece a Etapa 1.

=====

## Notas para quem entrega o prompt
- **Repositório:** `LetsDelivery/jiraIA` (criado em 2026-10-15).
- **Stack:** padrão do `LetsDelivery/uselets`, adotado em 2026-10-15, com os acréscimos da
  tabela "Acrescentado pelo JiraIA". A validação final é do Leandro Teves.
- **Para cumprir o prazo:** com uma pessoa só, as etapas 1 a 9 não cabem nas 6 semanas. O
  plano supõe o grupo do desafio dividido nas frentes de `plano.md`. Cada frente pode rodar o
  mesmo prompt, focada nas etapas dela, a partir da Etapa 1 concluída.
