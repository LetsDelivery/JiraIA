import { read } from '@/api/requests'
import { type SlackStatus, slackRead, slackWrite } from '@/api/slack'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { openFormDialog } from '@/ui/dialog'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'

import type { View } from './view'

/**
 * JiraIA in Slack (Etapa 5e, ADR-0018): what the connection brings — notices by direct message and
 * previews of cards — and its state. An organization admin connects the workspace; everyone else is
 * found in it by their e-mail.
 */
const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })

/** A Slack message, drawn by us, to show what arrives: the app's name, then what it says. */
const sample = (body: Html): Html => html`
  <div class="slack-sample" aria-hidden="true">
    <span class="slack-sample-app">${icon('kanban', 16)}</span>
    <div><p class="slack-sample-head"><strong>JiraIA</strong><span class="slack-sample-tag">APP</span><span class="muted">10:03</span></p>${body}</div>
  </div>`

const features = (): Html => html`
  <div class="slack-features">
    <article class="slack-feature">
      ${sample(html`<p>Admin atribuiu <a>PRD-219</a> a você</p><p class="muted">Cobrança automática de frete por região</p>`)}
      <h2>Avisos do JiraIA no Slack</h2>
      <p class="muted">Menções, cards atribuídos, comentários e mudanças de estado chegam por mensagem direta, na hora. Você escolhe quais em Configurações da conta.</p>
    </article>
    <article class="slack-feature">
      ${sample(html`<p class="slack-sample-card"><a>PRD-219 Cobrança automática de frete</a><span class="muted">Estado: Especificação · Tipo: Oportunidade · Responsável: Ana · Prioridade: Alta</span></p>`)}
      <h2>Prévias de cards</h2>
      <p class="muted">Cole o link de um card ou escreva a chave (PRD-219) num canal com o app: a prévia mostra estado, tipo, responsável e prioridade.</p>
    </article>
  </div>`

const connected = (status: SlackStatus & { workspace: NonNullable<SlackStatus['workspace']> }): Html => html`
  <div class="slack-state is-on">
    <p><strong>Conectado ao workspace ${status.workspace.teamName}</strong><span class="muted"> · por ${status.workspace.installedBy} em ${WHEN.format(new Date(status.workspace.installedAt))}</span></p>
    ${
      status.me?.found
        ? html`<p class="muted">Achamos você no Slack pelo seu e-mail. Escolha o que chega lá em <a href="/notificacoes/preferencias">Preferências de notificação</a>, opção “JiraIA e Slack”.</p>`
        : html`<p class="muted">Não achamos ninguém com o seu e-mail nesse workspace do Slack, então os avisos não chegam lá. Confira o e-mail do seu perfil no Slack.</p>`
    }
    ${status.canManage ? html`<button type="button" class="button button-ghost" data-slack-disconnect>Desconectar</button>` : ''}
  </div>`

/** Not connected: the admin connects; everyone else is told who can. */
const notConnected = (status: SlackStatus): Html => {
  if (!status.configured) {
    return html`<div class="slack-state"><p><strong>O app do Slack ainda não foi criado.</strong></p><p class="muted">A Tecnologia cria o app no workspace da LET’S; depois disso um administrador conecta aqui.</p></div>`
  }
  return status.canManage
    ? html`<div class="slack-state"><button type="button" class="button button-primary" data-slack-connect>${icon('slack', 16)}Conectar a um workspace do Slack</button><p class="muted">Você vai ao Slack autorizar o app e volta para cá.</p></div>`
    : html`<div class="slack-state"><p class="muted">O Slack ainda não está conectado. Um administrador da organização conecta aqui.</p></div>`
}

export const slackView: View = {
  path: '/slack',
  title: 'Slack',
  render: async () => {
    const status = await slackRead.status()
    return html`
      <header class="page-header"><div class="row">${icon('slack', 24)}<h1>Integração com o Slack</h1></div>
        <p class="muted">O JiraIA no Slack da LET’S: avisos para você e prévias de cards para a equipe.</p></header>
      ${features()}
      <section class="section">${status.workspace ? connected({ ...status, workspace: status.workspace }) : notConnected(status)}</section>
    `
  },
  bind: (root) => {
    const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
    root.querySelector('[data-slack-connect]')?.addEventListener('click', () => {
      void slackWrite
        .install()
        .then(({ url }) => window.location.assign(url))
        .catch(refuse)
    })
    root.querySelector('[data-slack-disconnect]')?.addEventListener('click', () =>
      openFormDialog({
        title: 'Desconectar o Slack',
        submit: 'Desconectar',
        done: 'Slack desconectado.',
        fields: html`<p class="muted">Ninguém recebe mais avisos no Slack e as prévias de cards param. Dá para conectar de novo depois.</p>`,
        onSubmit: () => slackWrite.disconnect()
      })
    )
  }
}

/** Where Slack sends the admin back: the code becomes the connection, and the Slack page opens. */
export const slackConnectView: View = {
  path: '/slack/conectar',
  title: 'Conectando o Slack',
  render: async () => {
    await read.me()
    return html`<div class="empty"><p class="empty-title">Conectando o Slack…</p></div>`
  },
  bind: () => {
    const query = new URLSearchParams(location.search)
    const [code, state] = [query.get('code'), query.get('state')]
    if (!code || !state) {
      toast(
        query.get('error') === 'access_denied'
          ? 'A conexão com o Slack foi cancelada.'
          : 'O Slack não devolveu a autorização.',
        'error'
      )
      navigate('/slack', true)
      return
    }
    slackWrite
      .complete(code, state)
      .then((status) => toast(`Slack conectado a ${status.workspace?.teamName ?? 'seu workspace'}.`))
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
      .finally(() => navigate('/slack', true))
  }
}
