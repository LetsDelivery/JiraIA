---
atualizado: 2026-10-15
dono: Vinicius André
---

# Diário: JiraIA

Registro datado de **decisões, marcos e mudanças de rumo**. Entrada mais recente no topo.
Não registre andamento diário de card (isso está no board) nem conteúdo de conversa de cliente.

## 2026-10-19: Assistente conectado por MCP age como a pessoa, sem aprovação
- **Tipo:** decisão (muda o princípio 2 de `arquitetura.md`)
- **O quê:** um aplicativo conectado por OAuth (por exemplo, a Laís) cria e altera cards **como a
  pessoa que o conectou**, com as permissões dela, sem passar por aprovação. O histórico mostra
  "Stênio criou o card (via Laís)". As **propostas** continuam só para agentes que agem sozinhos
  (contas de serviço, agentes com gatilho ou agenda).
- **Por quê:** é como o Jira funciona com o Claude. A pessoa já decidiu quando pediu ao assistente;
  exigir uma segunda aprovação vira gargalo.
- **Quem decidiu:** Stênio Lima. > TODO: alinhar com Vinicius André (dono das specs).
- **Links:** `docs/adr/0022-a-connected-application-acts-as-its-person.md` (repo de código)

## 2026-10-15: Board do Discovery Board e início da Etapa 2
- **Tipo:** marco
- **O quê:** fluxo configurável, cards `KEY-n`, board com arrastar e soltar, detalhe do card com campos
  padrão, comentários e histórico. O seed traz PRD · Discovery Board, REQ e TEC com os fluxos reais do
  Jira. O que falta da Etapa 2 está em `docs/etapas/2.md` do repo de código.
- **Quem decidiu:** Stênio Lima.

## 2026-10-15: Espaço passa a ser o "espaço" do Jira (um nível só)
- **Tipo:** decisão (muda o modelo do escopo original)
- **O quê:** sai o nível "Projeto". O Espaço tem chave (REQ, PRD, TEC), tipo (software, negócios,
  product discovery, service desk), líder e, na Etapa 2, os cards. Papéis só por espaço. O endereço do
  espaço usa a chave (`/espacos/REQ`). Só admins criam espaços. Na barra lateral, `+` e engrenagem
  aparecem no hover; a engrenagem abre a gestão com busca, filtros e as colunas da lista de espaços do
  Jira (nome, chave, tipo, líder, última atualização do ticket, URL).
- **Por quê:** o Jira renomeou projetos para espaços em 2025 e as áreas já falam assim; a migração fica
  1 para 1. Era o momento mais barato: ainda não havia cards nem deploy.
- **Quem decidiu:** Stênio Lima.
- **Links:** `docs/adr/0007-a-space-is-what-jira-calls-a-space.md` (repo de código)

## 2026-10-15: Painel em JavaScript puro, com vidro no que flutua
- **Tipo:** decisão (desvio do padrão uselets)
- **O quê:** o painel deixa o React, o TanStack, o Tailwind e o `@uselets/ui` e passa a ser JavaScript
  puro, empacotado pelo Vite. O design segue a skill `design-principles`; o glassmorfismo fica na
  barra lateral, no cabeçalho, nos diálogos, nos menus e nos toasts, com cards e tabelas sólidos.
- **Por quê:** as telas são simples e a carga fica leve: o JavaScript do painel caiu de 128 KB para
  12 KB comprimidos. Custo aceito: board com arrastar e soltar, lista virtualizada e editor das
  próximas etapas ficam por nossa conta, e a identidade do Max passa a ser CSS próprio.
- **Quem decidiu:** Stênio Lima, avisado dos custos.
- **Links:** `docs/adr/0006-plain-javascript-panel-with-glass-on-what-floats.md` (repo de código)

## 2026-10-15: Login com Google, sem Cognito
- **Tipo:** decisão
- **O quê:** o login passa a ser só com Google, para contas do Workspace `@uselets.com`. O Cognito e o
  serviço `identity` saem. O API Gateway valida o ID token do Google; o serviço confere o domínio
  (claim `hd`) e o e-mail verificado. Qualquer pessoa do domínio entra; quem entra pela primeira vez
  sem convite fica sem papel em nenhum espaço até ser incluída.
- **Por quê:** todo usuário do JiraIA já tem conta Google da LET'S; um segundo diretório de usuários
  e um código por e-mail não acrescentam nada.
- **Quem decidiu:** Stênio Lima.
- **Links:** `docs/adr/0005-google-sign-in-for-the-workspace-domain.md` (repo de código)

## 2026-10-15: Stack alinhada ao padrão uselets
- **Tipo:** mudança de rumo
- **O quê:**
  - O JiraIA adota as ferramentas, os frameworks e as convenções do `LetsDelivery/uselets`:
    bun, Biome, Lambda roteadora por contexto, EventBridge com SQS, Cognito, SAM, React 19,
    TanStack Router, Tailwind 4, `@uselets/ui`, ADRs em inglês e interface em pt-BR.
  - Saem Fastify, pnpm com Turborepo, Redis com BullMQ, Hocuspocus e OIDC genérico.
  - Desvios, acrescentados por exigência da spec: Aurora PostgreSQL Serverless v2 com pgvector
    via RDS Data API, em vez de DynamoDB; tempo real por API Gateway WebSocket com Lambda e Yjs,
    sem containers; TipTap; SDK da Anthropic; servidor MCP; Slack; gate de licenças.
  - O código vai para `LetsDelivery/jiraIA`.
- **Por quê:** usar o padrão que o time de desenvolvimento já valida e opera, em vez de uma
  stack nova.
- **Quem decidiu:** Stênio Lima. > TODO: validação final do Leandro Teves.
- **Links:** `prompt-construcao.md` (seção "Stack"), `arquitetura.md`

## 2026-10-15: Stack TypeScript e prompt de construção
- **Tipo:** decisão
- **O quê:** a stack é TypeScript de ponta a ponta (React, Fastify, Postgres com pgvector, TipTap com Yjs). O código fica no repositório que a LET'S já tem, construído por outra pessoa a partir de `prompt-construcao.md`.
- **Por quê:** velocidade com agentes de codificação e licenças permissivas.
- **Quem decidiu:** Vinicius André. > TODO: validação final do Leandro Teves.
- **Links:** `prompt-construcao.md`, `arquitetura.md`

## 2026-10-15: Clean room, referências só funcionais
- **Tipo:** decisão (proposta)
- **O quê:** o JiraIA é construído do zero. O Plane (AGPL-3.0), o Jira e o Confluence servem só
  como referência funcional, sem copiar código, componentes ou textos.
- **Por quê:** ter um produto 100% LET'S, sem obrigações de licença e livre para virar produto.
- **Quem decidiu:** Vinicius André (proposta). > TODO: validar com Jurídico e Tecnologia.
- **Links:** `decisoes/2026-10-15-jiraia-referencia-funcional.md`

## 2026-10-15: Proposta do projeto JiraIA
- **Tipo:** marco
- **O quê:** recebido o desafio da diretoria (Jira e Confluence internos com IA até o fim de
  novembro). Criada a proposta com escopo, arquitetura e plano. Foi feito o inventário do uso
  atual: 14 projetos no Jira e 6 espaços no Confluence.
- **Por quê:** formar o grupo até o fim da semana com uma proposta concreta na mão.
- **Quem decidiu:** Vinicius André
- **Links:** `README.md`, `escopo-mvp.md`, `arquitetura.md`, `plano.md`
