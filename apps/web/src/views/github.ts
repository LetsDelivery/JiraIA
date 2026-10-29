import { type GitHubStatus, githubRead, githubWrite } from '@/api/github'
import { read } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { openFormDialog } from '@/ui/dialog'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'

import type { View } from './view'

/**
 * JiraIA and GitHub (Etapa 9, ADR-0038): what the connection brings — each card's branches and pull
 * requests, and the card moving when its pull request is merged — and its state. An organization admin
 * installs the App on every repository of the GitHub account.
 */
const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })

const features = (): Html => html`
  <div class="integration-features">
    <article class="integration-feature">
      <h2>${icon('gitBranch', 18)}A chave do card no nome da branch</h2>
      <p class="muted">Crie a branch com a chave, como <code>feat/REQ-123-frete-por-regiao</code>. O botão “Copiar nome da branch” do card já monta esse nome. A chave no título do pull request também vale.</p>
    </article>
    <article class="integration-feature">
      <h2>${icon('gitPullRequest', 18)}O desenvolvimento dentro do card</h2>
      <p class="muted">Branches, pull requests, revisão e checks aparecem na seção Desenvolvimento do card, atualizados a cada novidade do GitHub.</p>
    </article>
    <article class="integration-feature">
      <h2>${icon('gitMerge', 18)}PR mergeado, card andando</h2>
      <p class="muted">Quando o pull request entra na branch principal do repositório, o card vai para o estado escolhido em Configurações › Fluxo do espaço.</p>
    </article>
  </div>`

const connected = (status: GitHubStatus & { installation: NonNullable<GitHubStatus['installation']> }): Html => html`
  <div class="integration-state is-on">
    <p><strong>Conectado à conta ${status.installation.account} no GitHub</strong><span class="muted"> · por ${status.installation.installedBy} em ${WHEN.format(new Date(status.installation.installedAt))}</span></p>
    <p class="muted">Todos os repositórios dessa conta contam para o JiraIA o que acontece com as branches e os pull requests.</p>
    ${status.canManage ? html`<button type="button" class="button button-ghost" data-github-disconnect>Desconectar</button>` : ''}
  </div>`

/** Not connected: the admin installs; everyone else is told who can. */
const notConnected = (status: GitHubStatus): Html => {
  if (!status.configured) {
    return html`<div class="integration-state"><p><strong>O app do GitHub ainda não foi criado.</strong></p><p class="muted">A Tecnologia cria o app na organização LetsDelivery do GitHub; depois disso um administrador conecta aqui.</p></div>`
  }
  return status.canManage
    ? html`<div class="integration-state">
        <button type="button" class="button button-primary" data-github-connect>${icon('github', 16)}Instalar no GitHub</button>
        <p class="muted">Você vai ao GitHub instalar o app em todos os repositórios e volta para cá. Instalar pede ser dono da organização no GitHub; se não for, o GitHub manda o pedido a um dono.</p>
        <p class="muted">Um dono da organização já instalou o app direto no GitHub?</p>
        <button type="button" class="button button-secondary" data-github-installed>Conectar a instalação existente</button>
      </div>`
    : html`<div class="integration-state"><p class="muted">O GitHub ainda não está conectado. Um administrador da organização conecta aqui.</p></div>`
}

export const githubView: View = {
  path: '/github',
  title: 'GitHub',
  render: async () => {
    const status = await githubRead.status()
    return html`
      <header class="page-header"><div class="row">${icon('github', 24)}<h1>Integração com o GitHub</h1></div>
        <p class="muted">Branches e pull requests no card, e o card andando quando o pull request é mergeado.</p></header>
      ${features()}
      <section class="section">${status.installation ? connected({ ...status, installation: status.installation }) : notConnected(status)}</section>
    `
  },
  bind: (root) => {
    const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
    root.querySelector('[data-github-connect]')?.addEventListener('click', () => {
      void githubWrite
        .install()
        .then(({ url }) => window.location.assign(url))
        .catch(refuse)
    })
    root.querySelector('[data-github-installed]')?.addEventListener('click', () => {
      void githubWrite
        .connectInstalled()
        .then((status) => {
          toast(`GitHub conectado à conta ${status.installation?.account ?? ''}.`)
          navigate('/github', true)
        })
        .catch(refuse)
    })
    root.querySelector('[data-github-disconnect]')?.addEventListener('click', () =>
      openFormDialog({
        title: 'Desconectar o GitHub',
        submit: 'Desconectar',
        done: 'GitHub desconectado.',
        fields: html`<p class="muted">Os cards deixam de receber novidades do GitHub; o que já aparece neles fica. Para remover o app também do GitHub, desinstale-o nas configurações da organização lá.</p>`,
        onSubmit: () => githubWrite.disconnect()
      })
    )
  }
}

/** Where GitHub sends the admin back after installing: the installation becomes the connection. */
export const githubConnectView: View = {
  path: '/github/conectar',
  title: 'Conectando o GitHub',
  render: async () => {
    await read.me()
    return html`<div class="empty"><p class="empty-title">Conectando o GitHub…</p></div>`
  },
  bind: () => {
    const query = new URLSearchParams(location.search)
    const [installationId, state] = [query.get('installation_id'), query.get('state')]
    if (query.get('setup_action') === 'request') {
      toast('Pedido enviado a um dono da organização no GitHub. Quando aprovarem, instale de novo aqui.')
      navigate('/github', true)
      return
    }
    if (!installationId || !state) {
      toast('O GitHub não devolveu a instalação.', 'error')
      navigate('/github', true)
      return
    }
    githubWrite
      .complete(installationId, state)
      .then((status) => toast(`GitHub conectado à conta ${status.installation?.account ?? ''}.`))
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
      .finally(() => navigate('/github', true))
  }
}
