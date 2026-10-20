---
atualizado: 2026-10-15
dono: Vinicius André
---

# JiraIA: arquitetura proposta

> **Stack alinhada ao padrão do time (`LetsDelivery/uselets`) em 2026-10-15.** Validação final
> com Leandro Teves (Tecnologia & Dados).
> TODO: contas AWS (dev, prd e tools) do JiraIA, com Tecnologia.

## Princípios
1. **Nativo em IA, não "IA colada".** Agente é um tipo de membro do espaço: tem papel, aparece
   no histórico, pode ser responsável por um card e responde a menções.
2. **Agentes propõem, pessoas aprovam.** Toda alteração feita por um agente vira uma
   **proposta**, com diff, autor e motivo. A proposta só é aplicada com aprovação humana. A
   execução automática fica restrita a ações que o dono do espaço liberar explicitamente.
3. **API primeiro.** A interface web, os agentes, o servidor MCP e as automações usam a mesma
   API, com as mesmas permissões.
4. **Configurável por área, sem código.** Fluxos, campos, formulários e automações são
   configuração do espaço. É isso que torna a plataforma compartilhada entre as áreas.
5. **Código 100% LET'S** (clean room) e só dependências com licença permissiva. Veja
   `decisoes/2026-10-15-jiraia-referencia-funcional.md`.
6. **Identidade do Max:** tokens próprios em CSS (vermelho do Max, Inter), skill `design-principles`.

## Visão geral

```
                ┌──────────────── Usuários (Google) ─────────────────────┐
                ▼                                                        ▼
        Web app (JavaScript puro)                           Claude Code / rotinas (MCP)
                │                                                        │
                ▼                                                        ▼
   ┌──────── API JiraIA (Lambda roteadora por contexto + API Gateway) ─────────────┐
   │ Espaços · Projetos · Cards · Fluxos · Campos · Páginas · Formulários          │
   │ Automações · Agentes · Propostas · Busca · Permissões · Auditoria             │
   └───────┬──────────────┬───────────────┬────────────────┬──────────────────────┘
           ▼              ▼               ▼                ▼
    Aurora Postgres  EventBridge +    Colaboração      Runtime de agentes
     (+ pgvector,    SQS (automações, em tempo real     (LLM + ferramentas
     via Data API)   e-mail, Slack,   (WebSocket +       = a própria API)
                     importação)      Lambda, Yjs)
           │
           ▼
   S3 (anexos, imagens de páginas)
```

## Stack (padrão `LetsDelivery/uselets`, adotado em 2026-10-15)
O JiraIA segue as ferramentas, os frameworks e as convenções do uselets, outro produto nativo em
IA da LET'S já validado pelo time de desenvolvimento. O detalhe camada a camada está em
`prompt-construcao.md`, seção "Stack". Resumo:

| Camada | Escolha | Origem |
|---|---|---|
| Monorepo e runtime | bun workspaces, Node 24, TypeScript, Biome, husky, commitlint, gitleaks | uselets |
| API | Lambda roteadora por contexto atrás de API Gateway HTTP API, zod 4 e OpenAPI gerado | uselets |
| Eventos, fila e agenda | EventBridge com SQS e DLQ por consumidor; `Schedule` do SAM | uselets |
| Login e permissões | Login com Google, só contas `@uselets.com`, token validado no API Gateway; autorização decidida no serviço | JiraIA (ADR-0005; o uselets usa Cognito) |
| Arquivos | S3 com URL pré-assinada | uselets |
| Front | JavaScript puro (sem framework), Vite, `openapi-fetch`; vidro só no que flutua | JiraIA (ADR-0006; o uselets usa React) |
| Infra e entrega | SAM/CloudFormation, config pelo SSM, GitHub Actions no runner CodeBuild, CodePipeline | uselets |
| Observabilidade e e-mail | Powertools, CloudWatch, X-Ray; SES | uselets |
| Banco | **Aurora PostgreSQL Serverless v2 + pgvector via RDS Data API**, com Drizzle | JiraIA (desvio da ADR 0002 do uselets) |
| Tempo real | **API Gateway WebSocket + Lambda**, com Yjs | JiraIA (o uselets não tem) |
| Editor de páginas | TipTap (MIT) | JiraIA |
| IA e MCP | `@anthropic-ai/sdk`; `@modelcontextprotocol/sdk` numa Lambda | JiraIA |
| Slack | Webhook de entrada | JiraIA |

Regra de dependência: o gate `check:licenses` bloqueia pacote com licença copyleft (GPL, AGPL,
LGPL sem análise, SSPL). Pacotes `@uselets/*` são da LET'S e são permitidos.

## Modelo de domínio (conceitual)
- **Organização** → **Espaço** (o "espaço" do Jira atual: REQ, PRD, TEC…), com chave, tipo, líder e
  os cards. A chave é preservada na migração (ADR-0007; antes havia um nível "Projeto", removido).
- **Membro:** pessoa ou **agente**, com papel por espaço: administrador, membro, convidado ou
  leitor.
- **Card:**
  - Atributos: tipo, título, descrição em rich text, estado, responsável, prioridade, labels,
    campos customizados, data limite e estimativa.
  - Relações: pai e subtarefas, e vínculos tipados (bloqueia, relaciona, entrega, duplica).
  - Interação: comentários, reações, anexos, observadores e histórico completo.
- **Fluxo:** estados por espaço, com **grupo de estado** (não iniciado, em andamento,
  concluído, cancelado) para métricas entre projetos. Aceita emoji no nome, como hoje no REQ.
- **Campo customizado:** texto, número, data, seleção única, seleção múltipla, pessoa e URL,
  por tipo de card.
- **Formulário:** campos mapeados para um tipo de card. Tem link interno e pode ser usado por
  quem não é membro do projeto.
- **Automação:** gatilho (criado, mudou de estado, campo alterado, agenda) → condições → ações
  (criar card em outro projeto, vincular, comentar, notificar Slack, chamar webhook, acionar
  agente).
- **Página:**
  - Organização: árvore por espaço.
  - Edição: conteúdo colaborativo e versões.
  - Vínculos: menções a cards e pessoas. Um card pode ser criado a partir de um trecho
    selecionado.
- **Visão salva:** filtros, agrupamento e layout (board, lista, backlog), pessoal ou do
  projeto.
- **Agente**, **Execução** e **Proposta:** veja abaixo.
- **Auditoria:** quem (pessoa ou agente), o quê, quando, valor antes e depois.

## Camada de agentes
### Definição de um agente
| Atributo | Descrição |
|---|---|
| Nome e avatar | Aparece como membro |
| Dono | Pessoa responsável pelo agente |
| Instruções | O que faz, em linguagem natural. Pode reaproveitar as skills de `.claude/skills/` |
| Ferramentas | Subconjunto da API: ler cards, propor card, comentar, ler páginas, propor página, buscar |
| Escopo | Espaços e projetos que ele enxerga |
| Gatilhos | Menção, atribuição, automação, agenda |
| Modo | **Propor** (padrão) ou **executar** (só ações liberadas pelo dono do espaço) |
| Orçamento | Limite de custo por execução e por mês |

### Execução
Cada execução registra a entrada, os passos (ferramentas chamadas), a saída, as propostas
geradas, o custo e o status. A tela do agente mostra as execuções. Qualquer proposta aplicada
pode ser revertida.

### Builder de projeto (o "builder" do desafio)
A área descreve o processo em linguagem natural. Por exemplo: "o Jurídico recebe pedidos de
contrato, revisa, negocia e arquiva". Um agente propõe o projeto inteiro: tipos de card,
fluxo, campos, formulário de entrada, automações e uma página de processo. A pessoa ajusta e
aprova. É assim que cada área sai do zero em minutos, sem administrador.

## Servidor MCP do JiraIA
Expõe a API como ferramentas MCP:
- buscar cards e páginas;
- ler um card ou uma página;
- propor criação ou alteração;
- comentar;
- listar estados e campos;
- consultar com filtro estruturado (o equivalente da JQL).

Com isso, as rotinas de `rotinas/README.md` e o Claude Code migram do conector Atlassian para
o JiraIA. As regras atuais continuam valendo: **ler e propor, não mover sem pedido explícito.**

## Busca
- **Texto:** busca em títulos, descrições, comentários e páginas.
- **Semântica:** embeddings em pgvector.
- **"Pergunte ao JiraIA":** um agente responde perguntas citando os cards e as páginas usados
  como fonte.
- **Filtro estruturado na interface:** projeto, estado, responsável, label, campo e datas.

## Segurança e LGPD
- SSO obrigatório. Permissões por espaço são aplicadas na API, então valem para interface,
  agentes e MCP do mesmo jeito.
- Auditoria imutável de alterações.
- Backup diário do banco e dos arquivos, com teste de restauração antes do corte.
- O agente só lê o que o escopo dele permite. As chamadas ao modelo de IA não retêm dados para
  treino.
  > TODO: confirmar os termos de dados com o fornecedor de IA e com o Jurídico.
- Cards e páginas seguem as regras de LGPD da LET'S: sem dado de consumidor final além do
  necessário.

## Migração (Jira e Confluence → JiraIA)
1. **Jira (API REST):**
   - Estrutura: projetos, tipos, estados, campos e usuários (mapeados por e-mail corporativo).
   - Conteúdo: cards, comentários, anexos, vínculos e histórico resumido.
   - As **chaves são preservadas** (REQ-123 continua REQ-123), assim os links em specs,
     Slack e neste repo seguem válidos.
2. **Confluence (API REST):** espaços, árvore de páginas, conteúdo convertido para o formato do
   editor, anexos e imagens.
3. **Ensaio:** importação completa em homologação, com conferência de contagens por projeto e
   espaço e amostragem com as áreas.
4. **Corte:** congelamento curto, importação incremental, Jira e Confluence em somente leitura
   por 30 dias. Depois, cancelamento das licenças.
