# Migração do Jira e do Confluence — acesso do importador

O importador lê o Jira e o Confluence com a conta do Stênio (`stenio.lima@parceiro.lets.delivery`,
admin do Jira e do Confluence) e um token **só de leitura** (ADR-0036). Ele nunca escreve na Atlassian.
Os passos abaixo são feitos pelo próprio Stênio; nenhum depende de admin da organização.

## 1. Criar o token só de leitura

Em **id.atlassian.com/manage-profile/security/api-tokens** (perfil da conta, não o
admin.atlassian.com) → **Criar token de API com escopos**. A Atlassian pede um código enviado por
e-mail antes de abrir a tela. As "Chaves de API" de admin.atlassian.com → Configurações da organização
não servem: os escopos delas (`read:…:admin`) só leem usuários, grupos e políticas da organização, não
cards nem páginas. Se o perfil só oferecer token **sem** escopos, não criar: ele escreveria com os
poderes de admin da conta; a alternativa só de leitura é um app OAuth 2.0 (3LO) em
developer.atlassian.com/console com escopos `read:`.

Cada token cobre um app só, então são **dois**: `JiraIA Importer - Jira` e
`JiraIA Importer - Confluence`.

- Validade: a maior disponível, de preferência até depois de 2026-12-31 (corte em 30/11 e mais 30 dias
  de Jira somente-leitura). Se a tela limitar, anote a data e crie outro antes de vencer.
- Escopos: filtrar por ação **Ler** e marcar **todos** os escopos de leitura do app (`read:…`).
  Nenhum `write:`, `delete:` ou `manage:`. No mínimo, no Jira: `read:jira-work`, `read:jira-user`,
  `read:board-scope:jira-software`, `read:sprint:jira-software`; no Confluence: `read:page`,
  `read:folder`, `read:whiteboard`, `read:database`, `read:embed`, `read:attachment`, `read:comment`,
  `read:space`, `read:hierarchical-content` e `read:user`, todos com o sufixo `:confluence`.

Cada token aparece uma vez só. Não cole em chat, Slack, e-mail, Jira, nem no repositório.

## 2. Guardar o token no Secrets Manager

AWS, conta **dev** (761817249596), região `us-east-1`, segredo `jiraia/atlassian`:

```json
{
  "cloud_id": "79f31c64-d22e-431f-959e-95ae9c0d7613",
  "account_email": "stenio.lima@parceiro.lets.delivery",
  "jira_token": "<token do Jira>",
  "jira_token_expires_at": "<data>",
  "confluence_token": "<token do Confluence>",
  "confluence_token_expires_at": "<data>"
}
```

Token com escopos fala com `https://api.atlassian.com/ex/jira/<cloud_id>/…` e
`https://api.atlassian.com/ex/confluence/<cloud_id>/…`, não com `letsdelivery.atlassian.net`. A conta
**prd** (009485101578) recebe o mesmo segredo só antes do corte.

## 3. Garantir que a conta enxerga tudo

O token vê o que a conta vê. Hoje a conta já enxerga os 14 projetos e os 4.795 cards. O ensaio de
contagem mostra o que faltar; para cada diferença:

- **Projeto do Jira:** Configurações do projeto → Acesso → adicionar-se como Visualizador.
- **Espaço do Confluence:** Configurações do espaço → Permissões → adicionar-se com Visualizar.
- **Página restrita:** adicionar-se como leitor na restrição da página.

## 4. Exportar o diretório de usuários ativos

admin.atlassian.com → Diretório → Usuários → Mais ações → **Exportar usuários**. Só os ativos: quem foi
desativado entra no JiraIA apenas como nome escrito no que fez, e o nome já vem no histórico da
Atlassian (ADR-0036). O CSV tem e-mails de pessoas e não entra no repositório: fica no S3 da migração.
Feito em 2026-10-28.

## 5. Gerar os backups nativos

Seguro extra, independente do importador; gerar uma vez, perto do corte (25 a 28/11).

- **Jira:** ⚙ → Sistema → **Gerenciador de backup** → "Backup para a nuvem", incluir anexos →
  **Criar backup para a nuvem**. Um backup a cada 48h; o link de download aparece na mesma tela.
- **Confluence:** ⚙ → **Backup manager** → "Backup de anexos" → **Criar backup para a nuvem**. O arquivo fica disponível
  só 14 dias, e o export XML do Confluence perde suporte em 2026-12-01: gerar perto do corte e copiar
  logo para o S3.

## 6. Listar as automações

Jira → Configurações → Sistema → **Automação global** (3 páginas de regras ativas) e **WebHooks**:
nome, escopo e o que cada uma faz, para recriar no JiraIA.

## Conferência

O primeiro ensaio só conta e compara com o inventário de 2026-10-28: **4.795 cards** nos 14 projetos;
no Confluence, **131 páginas, 65 whiteboards e 45 pastas**. Diferença aponta o projeto, espaço ou
página sem acesso.

## Depois do corte

Trinta dias depois do Jira e do Confluence ficarem somente-leitura, revogar o token.
