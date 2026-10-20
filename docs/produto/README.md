---
atualizado: 2026-10-15
dono: Vinicius André
projeto: JiraIA
produto: transversal
kr: okr-saude-escala
fase: discovery
---

# JiraIA

## Em uma frase
O JiraIA é a plataforma interna da LET'S para gestão de trabalho (o "nosso Jira") e
conhecimento (o "nosso Confluence"), nativa em IA. Pessoas e agentes trabalham no mesmo board.
O MVP entra em produção até **30/11/2026** e substitui o Jira e o Confluence sem perda de
funcionalidade no que usamos hoje.

> **Status: proposta.** Este documento é o ponto de partida para formar o grupo e validar
> escopo, stack e prazo com Tecnologia.

## Contexto e problema
- **Origem:** desafio da diretoria, recebido em 2026-10-15. O pedido é criar internamente as
  versões do Jira e do Confluence com IA até o fim de novembro. A construção será em conjunto
  com a Laís, alinhada com o Leandro Teves.
  > TODO: confirmar quem é a Laís (pessoa ou agente de IA) e qual é o papel dela no projeto.
- **Objetivo do desafio:** não perder funcionalidade, evoluir no conceito de **gestão de
  agentes de IA e builders de projeto** e gerar economia de longo prazo com uma plataforma
  compartilhada entre as áreas.
- **Condições do desafio:**
  - **Grupo:** nomes enviados até o fim da semana de 2026-10-15. Ao final, os participantes
    avaliam uns aos outros.
  - **Entrega:** ambiente real e operacional. O MVP precisa permitir substituir o Jira e o
    Confluence de fato. A validação é feita pelo grupo e pelas áreas usuárias.
  - **Dia a dia:** o projeto não pode atrasar as demandas regulares. Atraso justificado pelo
    projeto exclui o participante.
  - **Premiação:** R$ 8.000,00, divididos entre os participantes na entrega final.
- **Uso atual do Atlassian (inventário em 2026-10-15):**
  - **Jira:** 14 projetos de 4 tipos. *Software:* TEC, ORQ e SDDEC. *Business:* REQ, PRD,
    PERF, JUR, OLS, MARKETING e TASK. *Product Discovery:* FIB, GB, LP e MS.
  - **Confluence:** 6 espaços globais: Produto, Tech, LET'S Delivery, Customer Success Board,
    UX e DEMO.
  - Ou seja, o Jira não é só de Tecnologia: Jurídico, Marketing, Operações (OLS) e
    Performance também usam. Daí o ganho de uma plataforma compartilhada.
  > TODO: custo anual atual das licenças Atlassian e número de usuários, para calcular a
  > economia.

## Objetivo e ligação com OKR
- **KR:** `okr-saude-escala`, como projeto estruturante (crescer com saúde e escalabilidade).
  > TODO: confirmar se o JiraIA entra como projeto estruturante do KR3.
- **Métricas de sucesso (só as definições; os valores ficam na fonte):**
  - **Substituição:** % das áreas e dos projetos do Jira migrados e operando só no JiraIA.
    No corte de 30/11, a meta é 100% dos projetos business e software e dos espaços do
    Confluence. Product Discovery e service desk entram na onda 2 (veja `plano.md`).
  - **Paridade:** itens "obrigatórios" da matriz de `escopo-mvp.md` aprovados pelas áreas
    usuárias.
  - **Adoção (HEART: Adoption e Engagement):** usuários ativos por semana no JiraIA ÷ usuários
    que eram ativos no Jira.
  - **Agentes:** % de cards e páginas criados ou atualizados com ação de um agente e aprovados
    por uma pessoa.
  - **Economia:** custo de licenças Atlassian evitado menos o custo de infraestrutura e de IA do
    JiraIA, medido em 12 meses.

## Escopo
### Dentro (MVP até 30/11)
- **Trabalho:** espaços por área, projetos, cards com tipos, estados e fluxos configuráveis por
  projeto, campos customizados, subtarefas, vínculos entre cards, labels, prioridade,
  responsável, comentários com menção, anexos e histórico.
- **Visualizações:** board (kanban), lista e backlog. Inclui filtros salvos e busca.
- **Formulários de entrada:** substituem o formulário do REQ.
- **Automações básicas:** quando X, faça Y. Exemplo: card priorizado no REQ cria uma
  Oportunidade no PRD e avisa no Slack.
- **Páginas:** wiki com árvore de páginas por espaço, editor rico, colaboração em tempo real,
  histórico de versões e vínculo página ↔ card.
- **Agentes de IA:** agentes como membros do espaço, com papel, permissões e trilha de auditoria.
  Toda ação que altera dado passa por aprovação humana. Há um catálogo inicial de agentes
  (veja `escopo-mvp.md`).
- **Servidor MCP do JiraIA:** as rotinas deste repositório e o Claude Code passam a ler e
  propor mudanças no JiraIA como fazem hoje com o Atlassian.
- **Migração:** importação de projetos, cards, comentários, anexos e vínculos do Jira e de
  páginas do Confluence. As chaves (REQ-123, PRD-219…) são preservadas.
- **Acesso:** login corporativo (SSO) e papéis por espaço.

### Fora (depois do MVP)
- Ciclos e sprints com burndown, roadmap e Gantt, e analytics avançado.
  > TODO: confirmar com Tecnologia se o TEC usa sprint no Jira hoje. Se usar, sprint entra no MVP.
- Service desk com SLA e portal externo (SDDEC).
- Visões de Product Discovery (matriz de impacto, insights) dos projetos FIB, GB, LP e MS.
  Entram na onda 2.
- Builder visual de agentes, com fluxos multiagente desenhados pela própria área.
- Apps móveis, boards públicos e acesso de clientes ou OLs.

## Entregas (oportunidades e specs)
| Entrega | Card PRD | Spec | Observação |
|---|---|---|---|
| Proposta, escopo e plano | > TODO | `projetos/jiraia/` | Este documento |
| Escopo funcional do MVP e matriz de paridade | > TODO | `escopo-mvp.md` | Base para histórias |
| Arquitetura e camada de agentes | > TODO | `arquitetura.md` | Validar com Leandro Teves |
| Plano até 30/11, migração e rollout | > TODO | `plano.md` | |
| Prompt de construção (stack TypeScript) | > TODO | `prompt-construcao.md` | Para o time que vai codar |

O status de cada entrega está no Jira (e, depois do corte, no próprio JiraIA). Não copie para cá.

## Pessoas
| Papel | Nome | Área |
|---|---|---|
| Dono (Produto) | Vinicius André | Produto |
| Sponsor | > TODO: remetente do desafio | Diretoria |
| Tecnologia (alinhamento) | Leandro Teves | Tecnologia & Dados |
| Laís | > TODO: papel | > TODO |
| Grupo de trabalho | > TODO: nomes até o fim da semana de 2026-10-15 | |
| Design | > TODO | Design |
| Áreas validadoras | Produto, Tecnologia, Jurídico, Marketing, Operações, CS, Performance & Ops | |

## Clientes envolvidos
Uso interno. Os "clientes" são as áreas da LET'S que usam Jira e Confluence hoje.

## Dependências e riscos
| Risco | Mitigação |
|---|---|
| Prazo de ~6 semanas para substituir duas ferramentas | MVP pela matriz de paridade. Ondas de migração por área. Jira em somente leitura por 30 dias como rede de segurança |
| Concorrer com o dia a dia (regra de exclusão do desafio) | Capacidade fixa por pessoa, combinada com o gestor. Trabalho em blocos e agentes de IA para codificação |
| Licenciamento (Plane é AGPL) | Clean room: `decisoes/2026-10-15-jiraia-referencia-funcional.md` |
| Perda de dado ou de histórico na migração | Importação com ensaio e conferência de contagens por projeto antes do corte |
| Rotinas e automações que dependem do Atlassian (este repo, Slack, n8n) | Servidor MCP e webhooks prontos antes do corte. Inventário em `plano.md` |
| Segurança e LGPD (cards e páginas podem ter dados de cliente) | SSO, papéis, auditoria, backup diário e hospedagem na conta de nuvem da LET'S |
| Agente de IA alterar dado errado | Agentes só propõem. Pessoas aprovam. Tudo fica registrado e pode ser revertido |
| Custo de IA crescer com o uso | Orçamento por agente e painel de consumo |

## Links
- Jira (épico ou filtro): > TODO
- Figma: > TODO
- Repos de código: `LetsDelivery/jiraIA`. Padrão de stack e convenções: `LetsDelivery/uselets`
- Slack: > TODO: canal do projeto
- Referências funcionais: Plane (github.com/makeplane/plane), Jira e Confluence. **Só
  funcionalidade, nunca código.**

## Marcos
| Marco | Data prevista | Observação |
|---|---|---|
| Grupo formado e enviado | 2026-10-16 | Condição do desafio |
| Escopo, stack e plano validados | 2026-10-21 | Com Leandro Teves e o grupo |
| Fundação no ar (login, espaços, cards, board) | 2026-10-31 | Ambiente de homologação |
| Páginas, formulários, automações, MCP | 2026-11-14 | Piloto com Produto (REQ, PRD) |
| Migração ensaiada e agentes do catálogo inicial | 2026-11-21 | Piloto com TEC e espaço Produto |
| Corte: JiraIA em produção | 2026-11-30 | Jira em somente leitura |

## Perguntas em aberto
- Quem é a Laís e qual é o papel dela no projeto?
- ~~Qual stack a Tecnologia prefere manter?~~ Respondida em 2026-10-15: o padrão do
  `LetsDelivery/uselets`, com os desvios de `arquitetura.md`. Falta a validação final do
  Leandro Teves.
- Quais contas AWS (dev, prd e tools) o JiraIA usa: as do uselets ou contas próprias?
- O TEC usa sprint no Jira hoje?
- Quanto custam hoje as licenças Atlassian e quantos usuários temos?
- O que fazer com as automações e integrações do Atlassian que existem hoje, além da REQ → PRD?
- Que histórico migrar: tudo ou só os itens abertos e os últimos 12 meses?

## Aprendizados (preencher ao encerrar)
- …
