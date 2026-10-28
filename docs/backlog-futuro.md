# Backlog futuro

Ideias fora do MVP (prompt de construção, "Fora do escopo"). Registrar aqui em vez de construir.

- Roadmap, Gantt e calendário. (Sprints entraram no MVP: escopo-mvp 3.11, ADR-0029.)
- Time tracking. (Dashboards por espaço entraram no MVP na Etapa 5d, ADR-0016.)
- Relatórios: widget de link inteligente, pontos da história por estado, tempo de ciclo por squad,
  filtro de período no topo do painel, painéis que cruzam espaços, widgets de Git (commits,
  implantações, pull requests).
- Service desk com SLA (SDDEC). Visões de product discovery (FIB, GB, LP, MS).
- Boards públicos, acesso externo, apps móveis. Integrações além do Slack.
- Builder visual de fluxos multiagente.
- Automações do REQ que hoje rodam no Jira (lidas em 2026-10-28; a "01. Criação de oportunidade" já é a
  regra semeada da 5a). **02. Oportunidade priorizada:** REQ para "Itens priorizados" publica no canal
  `C0BEFEYEC3E` (qual canal? conectar o webhook) com chave, título, relator e link; falta o relator nos
  modelos de mensagem (`{{card.reporter}}`). **03. Item entregue em produção:** REQ para "Itens
  concluídos" gera um release note com IA a partir da descrição (O que mudou / Por que importa / Como
  usar) e publica no mesmo canal; falta uma ação de IA no motor, que depende da pendência #8. No Jira, a
  conexão do Slack dessas duas pede nova autenticação.
