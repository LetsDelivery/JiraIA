# Pendências externas

O que depende de acesso ou decisão fora do código. Cada item está atrás de variável de ambiente ou
de um dublê nos testes, e o código já está pronto para quando chegar.

| # | Pendência | Bloqueia | Com quem | Situação |
|---|---|---|---|---|
| 1 | Contas AWS do JiraIA (dev, prd, tools): as do uselets ou contas próprias | Primeiro deploy | Leandro Teves | Decidida em 2026-10-21: as contas do Max, 761817249596 (dev) e 009485101578 (prd), no `Mappings` do `template.yml` (ADR-0025) |
| 2 | Runner CodeBuild para o CI (padrão uselets ADR-0107) | CI fora do GitHub-hosted | Tecnologia | Aberta. Hoje roda em `ubuntu-latest` |
| 3 | Domínio do painel e da API: um certificado no ACM (us-east-1) e o registro DNS apontando para o CloudFront do `template.yml` | Endereço definitivo | Tecnologia | Aberta. Até lá painel e API respondem no `*.cloudfront.net` da distribuição; a API fica em `/api/work` na mesma origem e não precisa de CORS (ADR-0025) |
| 4 | Client OAuth do Google (tipo "Aplicativo da Web") no Google Cloud da LET'S, com o redirect URI do Cognito de cada conta: `https://jiraia-<conta>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse` (saída `SignInUrl` do stack). O client id vai em `GoogleClientId` no `Mappings` do `template.yml`, e o segredo em `client_secret` do segredo `jiraia/google` no Secrets Manager (ADR-0026). Marcar o client como Interno restringe o Google às contas do Workspace | Login com Google fora do ambiente local | Administrador do Google Workspace | Aberta. Sem ele, o user pool não tem provedor e ninguém entra |
| 6 | Validar as exceções de licença em `infra/ci/licenses-allowlist.json` (MPL-2.0, OFL-1.1, Python-2.0) | Clean room | Jurídico (Mariana Benjamin) | Aberta |
| 7 | Validar o entendimento sobre a licença do Plane | Clean room | Jurídico | Aberta (já estava no diário) |
| 8 | Chave da API da Anthropic e termos de dados. A chave vai para o Secrets Manager e para `ANTHROPIC_API_KEY` da função `jiraia` (ADR-0011) | “Criar com IA” do LET’S Draw AI (hoje 503 em AWS) e a Etapa 6 | Tecnologia e Jurídico | Aberta |
| 9 | Token da Atlassian (Jira e Confluence Cloud) | Etapa 8 | Administrador do Jira | Aberta |
| 10 | Slack: um *Incoming Webhook* para `#product_updates` (basta para as automações da 5a; o admin cola em **Integrações**). Para avisos por DM e prévias de cards (Etapa 5e, ADR-0018), um app do Slack no workspace da LET’S, configurado como em `docs/etapas/5e.md`, com os segredos em `jiraia/slack` no Secrets Manager e o client id em `SlackClientId` no `Mappings` do `template.yml` | Aviso no Slack em AWS; DMs e prévias | Tecnologia | Aberta. Localmente o harness imprime as mensagens e um app substituto conecta "LET’S (local)" |
| 11 | Remetente dos e-mails (Etapa 5f): domínio verificado no SES em cada conta, saída do sandbox do SES e registros DKIM no DNS da LET'S. O endereço vai em `MailFrom` no `Mappings` do `template.yml` | E-mails em AWS (até lá esperam) | Tecnologia e administrador do DNS | Em andamento: em dev, `uselets.com` está verificado e `MailFrom` é `jiraia@uselets.com`; no sandbox só chegam endereços @uselets.com. Prd falta verificar o domínio na conta e sair do sandbox. Localmente vira arquivo em `.local-mail/` |
| 12 | O pipeline do JiraIA no `aws-cicd` | Primeiro deploy | Tecnologia | Feita: `JiraIA`, branch `master`, stack `jiraia`, com o `buildspec.yml` e o `template.yml` da raiz (ADR-0025) |
