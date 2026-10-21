---
atualizado: 2026-10-21
dono: Stênio Lima
---

# Gestão de acessos e privilégios

Pedido do Jurídico: o JiraIA é o lugar onde a LET'S controla quem tem acesso a quê, em todos os
sistemas da empresa. Decisões técnicas em `docs/adr/0024`; entrega em `docs/etapas/7a.md`, `7b.md` e
`7c.md`.

## Por quê

Atender a ISO/IEC 27001:2022, Anexo A, nos controles de acesso:

| Controle | O que exige | Onde atendemos |
|---|---|---|
| 5.15 Controle de acesso | Regras de acesso definidas e aplicadas | Catálogo de sistemas e perfis; módulo fechado |
| 5.16 Gestão de identidade | Ciclo de vida das identidades | Pessoa entra sem acesso; desligamento remove tudo |
| 5.18 Direitos de acesso | Conceder, revisar e remover com autorização | Solicitação com motivo, aprovação, execução com evidência, revisão periódica |
| 8.2 Acesso privilegiado | Restringir e controlar privilégios | Perfil privilegiado: aprovação, validade de até 90 dias, revisão trimestral |
| 8.3 Restrição de acesso à informação | Acesso conforme a política | Visibilidade por papel no módulo |

E a ISO/IEC 27701:2019: cada sistema diz se guarda dado pessoal, e o relatório mostra quem o acessa.

> Os certificados da AWS (27001:2022 e 27701:2019) são **AWS Confidential**: não entram neste repo
> nem em páginas do JiraIA. Eles provam a parte da nuvem (controle 5.23), não substituem a nossa.

## Requisitos

| # | Funcionalidade | Prior. |
|---|---|---|
| A.1 | Catálogo de **sistemas**: nome, descrição, donos, operadores, se guarda dado pessoal, SLAs | M |
| A.2 | **Perfis** por sistema, padrão ou privilegiado. Acesso só existe por perfil (RBAC) | M |
| A.3 | **Solicitação** de concessão ou remoção de um perfil para uma pessoa, com motivo obrigatório | M |
| A.4 | Aprovação pelo dono do sistema. Ninguém aprova para si mesmo | M |
| A.5 | Execução pelo operador, com evidência (texto e anexo opcional) | M |
| A.6 | Trilha imutável: quem pediu, por quê, quem aprovou, quem executou, quando | M |
| A.7 | Pessoa nova sem nenhum acesso: mínimo por padrão | M |
| A.8 | Módulo fechado: cada um vê o seu; donos e operadores, seus sistemas; auditores, tudo | M |
| A.9 | SLA de concessão e de remoção, com prazo em dias úteis e alerta de atraso | M |
| A.10 | Desligamento abre remoção de todos os acessos, prazo de 24 h | M |
| A.11 | Privilegiado com validade (até 90 dias); vencido vira remoção | M |
| A.12 | Revisão periódica: trimestral para privilegiado, semestral para o resto | M |
| A.13 | Perfis de base por grupo: entrar no grupo abre a concessão já aprovada | O2 (não entregue) |
| A.14 | Relatórios e exportação CSV para auditoria (acessos atuais, histórico, cumprimento de SLA, dado pessoal) | M |
| A.15 | Carga inicial do inventário de acessos atuais | M |
| A.16 | Conectores que concedem e removem sozinhos (Google Workspace, AWS, GitHub) | D |

## SLA padrão

Configurável por sistema.

| Relógio | Começa | Prazo |
|---|---|---|
| Concessão | na aprovação | 2 dias úteis |
| Remoção a pedido ou por mudança de função | no pedido | 1 dia útil |
| Remoção por desligamento | na desativação da pessoa | 24 h corridas |
| Revisão | na abertura da campanha | 10 dias úteis |

Dia útil: calendário de São Paulo com feriados nacionais, mantido pelo admin da organização.

## Quem faz o quê

| Papel no módulo | Pode |
|---|---|
| Qualquer pessoa | Pedir acesso para si; ver os próprios acessos e pedidos |
| Gestor (dono de grupo) | Pedir acesso ou remoção para quem está no seu grupo |
| Dono do sistema | Aprovar ou recusar; revisar os acessos do sistema; editar perfis |
| Operador do sistema | Executar e registrar a evidência |
| Auditor de acessos | Ler e exportar tudo; não aprova nem executa |
| Admin da organização | Criar sistemas, nomear donos, operadores e auditores; feriados |

## Fora de escopo

- Terceiros sem conta no JiraIA (prestadores, parceiros).
- Senhas e segredos: o JiraIA registra o acesso, não guarda credencial.
- Fechar espaços do JiraIA para parte da LET'S: segue o caminho do item 1.8 (O2).

## Em aberto

- [x] Jurídico confirma os prazos de SLA (2026-10-21).
- [ ] Lista inicial de sistemas, donos e operadores: cadastrada na tela pelo admin da organização
  depois da 7a. Não bloqueia a construção.
- [ ] Inventário de acessos atuais: carregado pelo importador da 7c (A.15). Não bloqueia a
  construção. Até a carga, o JiraIA só registra acessos pedidos por ele.
- [ ] Auditores de acessos (Jurídico, Segurança): nomeados depois pelo admin da organização. Até lá,
  o admin da organização lê e exporta tudo, como já faz em qualquer papel (ADR-0012).
