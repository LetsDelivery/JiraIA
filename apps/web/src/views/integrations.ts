import { intakeRead, intakeWrite, type SlackChannel } from '@/api/intake'
import { read } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { openFormDialog, textField } from '@/ui/dialog'
import { icon } from '@/ui/icons'
import { bindServiceAccounts, serviceAccountsSection } from '@/ui/service-accounts'
import { toast } from '@/ui/toast'

import type { View } from './view'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })

const channelRow = (channel: SlackChannel, admin: boolean): Html => html`
  <tr>
    <td><strong>${channel.name}</strong></td>
    <td class="data">${channel.webhookHint}</td>
    <td class="muted">${WHEN.format(new Date(channel.createdAt))}</td>
    <td class="actions">${admin ? html`<button type="button" class="button button-ghost button-icon" data-remove-channel="${channel.id}" aria-label="Desconectar ${channel.name}">${icon('trash', 16)}</button>` : ''}</td>
  </tr>
`

const _connect = () =>
  openFormDialog({
    title: 'Conectar canal do Slack',
    submit: 'Conectar',
    done: 'Canal conectado.',
    fields: html`
      <p class="muted">No Slack, crie um <em>Incoming Webhook</em> para o canal e cole o endereço aqui. Quem tem o endereço publica no canal: ele nunca volta a aparecer inteiro.</p>
      ${textField({ name: 'name', label: 'Canal', placeholder: '#product_updates', required: true, maxLength: 80 })}
      ${textField({ name: 'webhookUrl', label: 'Endereço do webhook', type: 'url', placeholder: 'https://hooks.slack.com/services/…', required: true, maxLength: 500 })}
    `,
    onSubmit: (data) =>
      intakeWrite.addSlackChannel(String(data.get('name')).trim(), String(data.get('webhookUrl')).trim())
  })

/**
 * Where the organization's integrations live (escopo-mvp 4.5): today the Slack channels automations
 * post to. Everyone sees which exist; organization admins connect and disconnect them.
 */
export const integrationsView: View = {
  path: '/integracoes',
  title: 'Integrações',
  render: async () => {
    const [me, channels] = await Promise.all([read.me(), intakeRead.slackChannels()])
    const accounts = me.isOrgAdmin ? await serviceAccountsSection() : html``
    return html`
      <header class="page-header">
        <h1>Integrações</h1><p class="muted">Canais do Slack onde as automações publicam e contas de serviço da API.</p>
      </header>
      <section class="section">
        <div class="section-head">
          <div><h2>Canais do Slack</h2><p class="muted">Onde as automações publicam os avisos.</p></div>
          ${me.isOrgAdmin ? html`<button type="button" class="button button-primary" data-connect-slack>${icon('plus', 16)}Conectar canal</button>` : ''}
        </div>
        ${
          channels.items.length
            ? html`<table class="table people-table">
                <thead><tr><th>Canal</th><th>Webhook</th><th>Conectado em</th><th><span class="sr-only">Ações</span></th></tr></thead>
                <tbody>${channels.items.map((channel) => channelRow(channel, me.isOrgAdmin))}</tbody>
              </table>`
            : html`<div class="empty"><p class="empty-title">Nenhum canal conectado</p><p class="muted">Conecte o #product_updates para a automação do REQ avisar o time.</p></div>`
        }
      </section>
      ${accounts}
    `
  },
  bind: (root) => {
    root.querySelector('[data-connect-slack]')?.addEventListener('click', _connect)
    bindServiceAccounts(root)
    root.querySelector('table:not(.token-table) tbody')?.addEventListener('click', (event) => {
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-channel]')?.dataset.removeChannel
      if (id) {
        intakeWrite
          .removeSlackChannel(id)
          .then(() => toast('Canal desconectado.'))
          .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
      }
    })
  }
}
