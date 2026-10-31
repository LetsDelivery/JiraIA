import { type Channel, noticesRead, noticesWrite, type Preference } from '@/api/notifications'
import { slackRead } from '@/api/slack'
import { type Html, html } from '@/lib/html'
import { CHANNEL_LABEL, channelsLabel, channelsOf, KIND_LABEL, toggleChannel } from '@/lib/notifications'
import { refusalSentence } from '@/lib/refusal'

import { icon } from './icons'
import { openFloating } from './picker'
import { toast } from './toast'

/**
 * Where each kind of notice goes — any of JiraIA, e-mail and Slack, or nowhere (escopo-mvp 4.6, Etapas
 * 5e and 5f). Shown in Preferências de notificação, which the account menu opens.
 */
const HINT: Record<Channel, string> = {
  in_app: 'Central de Notificações. Desmarcar desliga todos.',
  email: 'Menções e acessos na hora; o resto agrupado.',
  slack: 'Mensagem direta, na hora.'
}

const trigger = (preference: Preference): Html => html`
  <button type="button" class="select-trigger channel-trigger" data-preference="${preference.kind}" data-channels="${preference.channels.join(',')}" aria-haspopup="dialog" aria-expanded="false" aria-label="Como avisar: ${KIND_LABEL[preference.kind].label}">
    <span class="select-value">${channelsLabel(preference.kind, preference.channels)}</span>${icon('chevronDown', 16)}
  </button>
`

const preferenceRow = (preference: Preference): Html => html`
  <tr>
    <td><strong>${KIND_LABEL[preference.kind].label}</strong><p class="muted">${KIND_LABEL[preference.kind].hint}</p></td>
    <td>${trigger(preference)}</td>
  </tr>
`

/** Whether the person can be reached in Slack, and how to choose it. */
const slackLine = async (): Promise<Html> => {
  const status = await slackRead.status()
  const text = !status.workspace
    ? 'O Slack ainda não está conectado à organização.'
    : status.me?.found
      ? `Conectado a ${status.workspace.teamName}: marque “Slack” nos avisos que quer receber lá.`
      : `Conectado a ${status.workspace.teamName}, mas não achamos você lá pelo seu e-mail.`
  return html`<p class="muted settings-slack">${icon('slack', 16)}${text} <a href="/slack">Ver a integração</a></p>`
}

export const preferencesPanel = async (): Promise<Html> => {
  const [{ items }, slack] = await Promise.all([noticesRead.preferences(), slackLine()])
  return html`
    ${slack}
    <p class="muted">Por e-mail, menções e acessos chegam na hora; as mudanças de um card chegam juntas, 10 minutos depois; o LET’S Draw AI manda um resumo às 8h. No Slack, o aviso chega na hora, por mensagem direta.</p>
    <table class="table preference-table"><tbody>${items.map(preferenceRow)}</tbody></table>
  `
}

const channelBox = (kind: Preference['kind'], channel: Channel, on: boolean): Html => html`
  <label class="channel-option">
    <input type="checkbox" value="${channel}" ${on ? html`checked` : ''} />
    <span><strong>${kind === 'weekly_summary' ? 'Receber por e-mail' : CHANNEL_LABEL[channel]}</strong><small class="muted">${HINT[channel]}</small></span>
  </label>
`

/** Draws a choice on its trigger and its boxes. */
const _show = (button: HTMLElement, menu: HTMLElement, kind: Preference['kind'], channels: readonly Channel[]) => {
  button.dataset.channels = channels.join(',')
  ;(button.querySelector('.select-value') as HTMLElement).textContent = channelsLabel(kind, channels)
  for (const box of menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    box.checked = channels.includes(box.value as Channel)
  }
}

/** The boxes of one kind, floating under its trigger; each tick is saved at once. */
const _open = (button: HTMLElement): void => {
  const kind = button.dataset.preference as Preference['kind']
  const current = () => (button.dataset.channels ? button.dataset.channels.split(',') : []) as Channel[]
  const menu = document.createElement('div')
  menu.className = 'channel-menu'
  menu.setAttribute('role', 'group')
  menu.setAttribute('aria-label', button.getAttribute('aria-label') ?? '')
  menu.innerHTML =
    html`${channelsOf(kind).map((channel) => channelBox(kind, channel, current().includes(channel)))}`.value
  button.setAttribute('aria-expanded', 'true')
  openFloating(button, menu, () => button.setAttribute('aria-expanded', 'false'))
  menu.addEventListener('change', (event) => {
    const box = event.target as HTMLInputElement
    const before = current()
    const next = toggleChannel(kind, before, box.value as Channel, box.checked)
    _show(button, menu, kind, next)
    void noticesWrite
      .setPreference(kind, next)
      .then(() => toast('Preferência salva.'))
      .catch((refusal: unknown) => {
        _show(button, menu, kind, before)
        toast(refusalSentence(refusal), 'error')
      })
  })
  menu.querySelector<HTMLInputElement>('input')?.focus()
}

export const bindPreferences = (root: HTMLElement): void => {
  for (const button of root.querySelectorAll<HTMLElement>('[data-preference]')) {
    button.addEventListener('click', () => _open(button))
  }
}
