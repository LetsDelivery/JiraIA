---
atualizado: 2026-10-15
dono: Vinicius André
---

# JiraIA: escopo funcional do MVP e matriz de paridade

Este é o documento-base de **clean room**. Ele descreve **o que** o JiraIA faz, em palavras
nossas, a partir de três referências: o uso atual do Jira e do Confluence na LET'S e o
inventário funcional de ferramentas abertas, como o Plane. Não contém código nem texto de
interface de terceiros. Quem implementa trabalha a partir daqui
(`decisoes/2026-10-15-jiraia-referencia-funcional.md`).

**Legenda de prioridade:**
- **M:** obrigatório para o corte de 30/11. Sem isso, não substitui.
- **O2:** onda 2 (dezembro).
- **D:** depois, no backlog evolutivo.

**Origem:**
- **J:** usamos hoje no Jira.
- **C:** usamos hoje no Confluence.
- **R:** referência de mercado; não usamos hoje.
- **N:** novo, diferencial do JiraIA.

## 1. Estrutura e acesso
| # | Funcionalidade | Prior. | Origem |
|---|---|---|---|
| 1.1 | Organização → espaços com chave curta (REQ, PRD, TEC…), tipo, líder e numeração sequencial dos cards (o espaço é o "espaço" do Jira atual, ADR-0007) | M | J |
| 1.2 | Login corporativo (SSO). Sem senha própria | M | J |
| 1.3 | Papéis por espaço: administrador, membro, convidado e leitor | M | J |
| 1.4 | Convite de pessoas e desativação, preservando o histórico | M | J |
| 1.5 | Agentes de IA como membros, com papel e escopo | M | N |
| 1.6 | Auditoria de todas as alterações (pessoa ou agente, antes e depois) | M | R |
| 1.7 | Arquivar e restaurar espaço | M | J |
| 1.8 | Espaços e páginas privados | O2 | R |

## 2. Cards (o "Jira")
| # | Funcionalidade | Prior. | Origem |
|---|---|---|---|
| 2.1 | Tipos de card por espaço (Requisição, Oportunidade, Epic, História, Tarefa, Bug, Spike, Data…) | M | J |
| 2.2 | Fluxo de estados configurável por espaço, com nome livre (inclusive emoji) e grupo de estado (não iniciado, em andamento, concluído, cancelado) | M | J |
| 2.3 | Transições livres entre estados (sem regras) | M | J |
| 2.4 | Campos padrão: título, descrição rica, responsável, relator, prioridade (5 níveis), labels, data limite, estimativa (P/M/G ou pontos) | M | J |
| 2.5 | Campos customizados por tipo: texto, número, data, seleção única, seleção múltipla, pessoa, URL | M | J |
| 2.6 | Subtarefas e hierarquia (Epic → História → Subtarefa) | M | J |
| 2.7 | Vínculos tipados entre cards de qualquer espaço: relaciona, bloqueia/bloqueado por, duplica, entrega/entregue por (substitui o "Polaris" PRD ↔ TEC), incidente | M | J |
| 2.8 | Comentários ricos com menção a pessoas e agentes, reações e edição | M | J |
| 2.9 | Anexos (upload e colar imagem) | M | J |
| 2.10 | Histórico campo a campo de cada card | M | J |
| 2.11 | Observadores (assinar card) | M | J |
| 2.12 | Links externos com prévia | O2 | R |
| 2.13 | Rascunho de card | D | R |
| 2.14 | Mover card entre espaços, mantendo o histórico e redirecionando a chave antiga | M | J |
| 2.15 | Clonar card | O2 | J |
| 2.16 | Auto-arquivar ou fechar cards parados há N meses | D | R |
| 2.17 | Regras de transição (campos obrigatórios ao entrar em um estado) | O2 | J |

## 3. Visualizações e busca
| # | Funcionalidade | Prior. | Origem |
|---|---|---|---|
| 3.1 | Board kanban por estado, com arrastar e soltar e raias (agrupamento secundário) | M | J |
| 3.2 | Lista ou tabela com colunas configuráveis | M | J |
| 3.3 | Backlog com ordenação manual | M | J |
| 3.4 | Filtros por espaço, tipo, estado, responsável, label, prioridade, campo customizado, datas e "mudou para estado X depois de D" | M | J |
| 3.5 | Visões salvas (pessoais e do projeto). Substituem as JQLs de `backlog/fluxo-jira.md` | M | J |
| 3.6 | Busca textual global (cards, comentários, páginas) e navegação pela chave (digitar "PRD-219") | M | J |
| 3.7 | Paleta de comandos e atalhos de teclado | O2 | R |
| 3.8 | Ações em massa (mudar estado, label ou responsável de vários cards) | M | J |
| 3.9 | Calendário e linha do tempo (Gantt) | D | R |
| 3.10 | Exportar resultados para CSV/XLSX | O2 | J |
| 3.11 | Sprints por espaço: planejar no backlog, iniciar, encerrar levando os abertos, board da sprint ativa, burndown e velocidade (ADR-0029) | M | J |
| 3.11 | Busca semântica e "Pergunte ao JiraIA" com fontes citadas | M | N |
| 3.12 | Visão de matriz esforço × impacto (Product Discovery) | O2 | J |

## 4. Entrada, automação e notificação
| # | Funcionalidade | Prior. | Origem |
|---|---|---|---|
| 4.1 | Formulários de entrada por espaço (campos mapeados, label automática). Substituem o formulário do REQ | M | J |
| 4.2 | Automações gatilho → condição → ação: criar card em outro projeto, vincular, mudar campo, comentar, notificar | M | J |
| 4.3 | Automação "REQ priorizado → cria Oportunidade no PRD + publica no Slack #product_updates" | M | J |
| 4.4 | Automação "TEC concluído → atualiza o PRD vinculado" | M | J |
| 4.5 | Integração com Slack (publicar em canal, prévia de link do card) | M | J |
| 4.6 | Notificações in-app (inbox com lido, adiado, arquivado) e e-mail consolidado, com preferências por tipo | M | J |
| 4.7 | Webhooks de saída assinados, com retentativa | M | R |
| 4.8 | API REST com token pessoal ou de serviço | M | J |
| 4.9 | Servidor MCP do JiraIA (ler, buscar, propor, comentar) | M | N |
| 4.10 | Triagem com status (pendente, aceito, recusado, adiado, duplicado) | O2 | R |
| 4.11 | Entrada por e-mail | D | R |
| 4.12 | Service desk com SLA e portal externo (SDDEC) | O2 | J |

## 5. Páginas (o "Confluence")
| # | Funcionalidade | Prior. | Origem |
|---|---|---|---|
| 5.1 | Árvore de páginas por espaço, com aninhamento, mover e reordenar | M | C |
| 5.2 | Editor rico em blocos: títulos, listas, listas de tarefa, citação, destaque, código, tabelas, imagens, anexos, divisor, comando "/" e atalhos markdown | M | C |
| 5.3 | Coedição em tempo real com cursores | M | C |
| 5.4 | Histórico de versões com comparação e restauração | M | C |
| 5.5 | Menção a pessoas e cards. Card embutido na página com o estado ao vivo | M | C |
| 5.6 | Criar card a partir de um trecho selecionado | M | N |
| 5.7 | Comentários em página (gerais e no trecho) | M | C |
| 5.8 | Backlinks: em que páginas e cards esta página é citada | O2 | R |
| 5.9 | Índice automático de títulos | O2 | C |
| 5.10 | Templates de página (spec, ata, decisão, release note) | O2 | C |
| 5.11 | Exportar PDF | O2 | C |
| 5.12 | Página pública (link externo) | D | C |
| 5.13 | Bloquear página para edição | O2 | C |

## 6. Agentes de IA e builders (diferencial)
| # | Funcionalidade | Prior. | Origem |
|---|---|---|---|
| 6.1 | Cadastro de agente: nome, dono, instruções, ferramentas, escopo, gatilhos, modo (propor ou executar), orçamento | M | N |
| 6.2 | Propostas com diff, aprovar ou recusar, e reversão de proposta aplicada | M | N |
| 6.3 | Acionar agente por menção, atribuição, automação ou agenda | M | N |
| 6.4 | Tela de execuções: passos, custo, resultado | M | N |
| 6.5 | **Builder de projeto:** a área descreve o processo e o agente propõe o projeto inteiro (tipos, fluxo, campos, formulário, automações, página de processo) | M | N |
| 6.6 | Assistente no editor: escrever, resumir, reescrever e traduzir | M | R |
| 6.7 | Painel de consumo de IA por agente e por espaço | O2 | N |
| 6.8 | Builder visual de fluxos multiagente | D | N |

### Catálogo inicial de agentes
Os agentes iniciais reaproveitam as skills que já existem em `.claude/skills/`.

| Agente | O que faz | Base | Gatilho |
|---|---|---|---|
| **Builder** | Monta projeto, fluxo e formulário a partir da descrição do processo | novo | Manual |
| **Triagem** | Classifica a REQ, sugere label de OKR e HEART, aponta duplicadas e falta de informação | `prioritization-analysis` | Card criado no REQ |
| **Spec** | Escreve a Oportunidade no padrão do PRD (contexto, problema, escopo, regras, critérios) | `spec-task` | Entrar em "Especificação" |
| **Histórias** | Quebra a Oportunidade em histórias com critérios de aceite para o TEC | `user-story-refinement` | Entrar em "Em refinamento" |
| **Release** | Rascunha a release note da semana a partir dos cards lançados | `product-documentation` | Agenda semanal |
| **Pergunte ao JiraIA** | Responde perguntas sobre cards e páginas, citando as fontes | novo | Menção ou busca |

## 7. Migração
| # | Funcionalidade | Prior. | Origem |
|---|---|---|---|
| 7.1 | Importar do Jira: espaços, tipos, estados, campos, cards, comentários, anexos, vínculos, labels, preservando as chaves | M | J |
| 7.2 | Importar do Confluence: espaços, árvore, conteúdo, anexos e imagens | M | C |
| 7.3 | Mapear usuários por e-mail corporativo | M | J |
| 7.4 | Relatório de conferência (contagens por espaço do Jira e do Confluence) | M | N |
| 7.5 | Importação incremental no corte | M | N |
| 7.6 | Redirecionar links antigos do Jira e do Confluence | O2 | N |

## 8. Não funcional
| # | Requisito | Prior. |
|---|---|---|
| 8.1 | Abrir board e página em menos de 2 s com o volume migrado | M |
| 8.2 | Backup diário com restauração testada | M |
| 8.3 | Identidade visual do Max (design system LET'S), interface em pt-BR | M |
| 8.4 | Uso em navegador desktop. Mobile: só leitura responsiva | M |
| 8.5 | Checagem de licença de dependências no CI (bloqueia copyleft) | M |
| 8.6 | Monitoramento de erros e disponibilidade | M |

## Fora do MVP (registro para não reabrir sem motivo)
- Roadmap, Gantt e calendário. (Sprints com burndown entraram no MVP em 2026-10-23: o TEC usa
  sprint no Jira — item 3.11, ADR-0029.)
- Time tracking e worklog, dashboards customizados, linguagem de consulta própria.
- Boards públicos, acesso de clientes e OLs, apps móveis.
- Integrações com Zendesk e outras além do Slack. (GitHub entrou em 2026-10-29, Etapa 9: branches e
  pull requests no card e o card indo para revisão no merge — ADR-0038.)

> TODO: validar a matriz com as áreas usuárias. Cada área marca o que usa de fato hoje.
> Proposta: uma rodada de 30 min por área na S1.
