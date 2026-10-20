---
atualizado: 2026-10-15
dono: Vinicius André
---

# JiraIA: plano até 30/11/2026

> Proposta. As datas são marcos de referência. O andamento fica no board do projeto, não aqui.

## Como o grupo se organiza
O desafio exclui quem atrasar o dia a dia. Por isso o plano parte de **capacidade fixa e
combinada**, não de esforço heroico.

- **Capacidade:** cada pessoa combina com o gestor um bloco semanal fixo para o projeto.
  > TODO: horas por semana por participante.
- **Frentes**, cada uma com um responsável:

| Frente | Entrega |
|---|---|
| Trabalho | Espaços, projetos, cards, fluxos, campos, board, lista, backlog, filtros |
| Páginas | Wiki, editor, tempo real, versões, vínculo com cards |
| IA e agentes | Runtime de agentes, propostas, catálogo inicial, builder de projeto, busca semântica, MCP |
| Plataforma e migração | Infra, SSO, permissões, auditoria, backup, importadores, automações, Slack |
| Produto e design | Specs, telas no padrão Max, validação com as áreas, comunicação, treinamento |

- **Clean room:** quem lê o Plane e outras referências fica na frente de Produto e entrega só
  especificação. Quem codifica não abre o código do Plane.
- **Rituais (curtos, para proteger o dia a dia):**
  - status assíncrono diário no canal do projeto;
  - **demo de 30 min toda sexta** com as áreas usuárias;
  - decisões registradas em `diario.md`.
- **O próprio projeto é gerido no JiraIA** assim que a fundação subir (dogfooding).

## Cronograma
| Semana | Período | Foco | Saída |
|---|---|---|---|
| S0 | 15–17/10 | Formar o grupo, validar a proposta | Nomes enviados à diretoria. Frentes e responsáveis |
| S1 | 20–24/10 | Fundação | Stack validada com Tecnologia, repo e CI, SSO, espaços, projetos, cards, fluxos. Specs do MVP em histórias |
| S2 | 27–31/10 | Trabalho utilizável | Board, lista, backlog, campos, comentários, anexos, histórico. **Homologação no ar** |
| S3 | 03–07/11 | Páginas e entrada | Editor e wiki em tempo real, formulários, automações básicas, notificações, Slack |
| S4 | 10–14/11 | IA e integração | Runtime de agentes e propostas, catálogo inicial, busca, servidor MCP. **Piloto: Produto (REQ, PRD)** |
| S5 | 17–21/11 | Migração | Importadores do Jira e do Confluence, ensaio completo. **Piloto: TEC e espaço Produto**. Builder de projeto |
| S6 | 24–28/11 | Endurecimento | Correções do piloto, permissões, backup e restauração, treinamento das áreas |
| Corte | 30/11 | **Produção** | Importação final. Jira e Confluence em somente leitura |

## Ondas de migração
| Onda | Quando | O quê | Condição |
|---|---|---|---|
| Piloto | S4–S5 | REQ, PRD, TEC e espaço Produto | Produto e Tecnologia operando em paralelo |
| Corte | 30/11 | Projetos business e software: REQ, PRD, TEC, ORQ, PERF, JUR, OLS, MARKETING, TASK. Espaços do Confluence | Paridade aprovada (`escopo-mvp.md`) |
| Onda 2 | Dezembro | Projetos de Product Discovery (FIB, GB, LP, MS) e service desk (SDDEC) | Depende de funcionalidades fora do MVP |

> TODO: confirmar com a diretoria se a onda 2 em dezembro atende à condição de "substituição
> efetiva", ou se esses projetos precisam entrar no corte.

## Inventário do que depende do Atlassian hoje
| Dependência | Destino no JiraIA | Frente |
|---|---|---|
| Formulário do REQ (label `business-form`) | Formulário nativo | Trabalho |
| Automação REQ priorizado → cria Oportunidade no PRD + Slack #product_updates | Automação nativa + Slack | Plataforma |
| Vínculo PRD ↔ TEC (tipo "Polaris"/entrega) e conclusão do PRD quando o TEC conclui | Vínculo tipado "entrega" + automação | Trabalho |
| Labels de OKR e HEART (`decisoes/2026-09-29-labels-okr-heart.md`) | Labels migradas como estão | Migração |
| Rotinas deste repo que leem o Jira (priorização, roadmap, release note, performance) | Servidor MCP do JiraIA. Atualizar `fontes/mapa-de-fontes.md` e `backlog/fluxo-jira.md` | IA |
| JQLs de `backlog/fluxo-jira.md` | Visões salvas equivalentes | Produto |
| Links para páginas do Confluence (Esteira, Requisições para Produto) | Páginas migradas, com redirecionamento de links | Migração |
| Outras automações e integrações do Atlassian | > TODO: levantar com o administrador do Jira | Plataforma |
| Fluxos no n8n que usam Jira ou Confluence | > TODO: levantar | Plataforma |

## Critérios de pronto para o corte (30/11)
- [ ] Todos os itens **obrigatórios** da matriz de `escopo-mvp.md` foram validados pelas áreas
      usuárias.
- [ ] O ensaio de migração bateu as contagens por projeto e espaço (cards, comentários, anexos,
      páginas) e a amostragem foi aprovada pelas áreas.
- [ ] Automação REQ → PRD + Slack funcionando em produção.
- [ ] Ao menos uma rotina deste repo rodando via MCP do JiraIA.
- [ ] SSO, papéis por espaço, auditoria e backup com restauração testada.
- [ ] Treinamento feito com cada área e guia rápido publicado como página no JiraIA.
- [ ] Plano de volta: Jira e Confluence em somente leitura por 30 dias, com reabertura possível.
