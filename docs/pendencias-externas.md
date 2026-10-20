# Pendências externas

O que depende de acesso ou decisão fora do código. Cada item está atrás de variável de ambiente ou
de um dublê nos testes, e o código já está pronto para quando chegar.

| # | Pendência | Bloqueia | Com quem | Situação |
|---|---|---|---|---|
| 1 | Contas AWS do JiraIA (dev, prd, tools): as do uselets ou contas próprias | Primeiro deploy | Leandro Teves | Aberta |
| 2 | Runner CodeBuild para o CI (padrão uselets ADR-0107) | CI fora do GitHub-hosted | Tecnologia | Aberta. Hoje roda em `ubuntu-latest` |
| 3 | Domínio da API e do painel (`infra/edge`, `infra/web`) e origem para o CORS | Painel publicado | Tecnologia | Aberta. Templates usam `localhost:5280` |
| 4 | Client OAuth do Google (tipo "Aplicativo da Web") no Google Cloud da Let's, com as origens do painel autorizadas. O client id vai para `VITE_GOOGLE_CLIENT_ID` e para o SSM `/jiraia/<env>/google/client-id` (ADR-0005) | Login com Google fora do ambiente local | Administrador do Google Workspace | Aberta |
| 6 | Validar as exceções de licença em `infra/ci/licenses-allowlist.json` (MPL-2.0, OFL-1.1, Python-2.0) | Clean room | Jurídico (Mariana Benjamin) | Aberta |
| 7 | Validar o entendimento sobre a licença do Plane | Clean room | Jurídico | Aberta (já estava no diário) |
| 8 | Chave da API da Anthropic e termos de dados. A chave vai para o Secrets Manager e para `ANTHROPIC_API_KEY` da função `router` do `work` (ADR-0011) | “Criar com IA” do Let’s Draw AI (hoje 503 em AWS) e a Etapa 6 | Tecnologia e Jurídico | Aberta |
| 9 | Token da Atlassian (Jira e Confluence Cloud) | Etapa 8 | Administrador do Jira | Aberta |
| 10 | Slack: um *Incoming Webhook* para `#product_updates` (basta para as automações da 5a; o admin cola em **Integrações**). Para avisos por DM e prévias de cards (Etapa 5e, ADR-0018), um app do Slack no workspace da Let’s, configurado como em `docs/etapas/5e.md`, com os segredos em `/jiraia/<env>/slack` e o client id no parâmetro `SlackClientId` | Aviso no Slack em AWS; DMs e prévias | Tecnologia | Aberta. Localmente o harness imprime as mensagens e um app substituto conecta "Let’s (local)" |
| 11 | Remetente do e-mail diário: domínio ou endereço verificado no SES (`jiraia@uselets.com`), saída do sandbox do SES e registros SPF/DKIM no DNS da Let's. O endereço vai no parâmetro `MailFrom` do stack `work` | E-mail diário de notificações em AWS (até lá os resumos esperam) | Tecnologia e administrador do DNS | Aberta. Localmente vira arquivo em `.local-mail/` |
