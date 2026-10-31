import { noticesRead, noticesWrite, type Preference } from '@/api/notifications'
import { slackRead } from '@/api/slack'
import { type Html, html } from '@/lib/html'
import { CHANNEL_LABEL, channelsOf, KIND_LABEL, SUMMARY_KINDS } from '@/lib/notifications'
import { refusalSentence } from '@/lib/refusal'

import { icon } from './icons'
import { selectField } from './select'
import { toast } from './toast'

/**
 * What each kind of notice does — panel only, also by e-mail, Slack, or nothing (escopo-mvp 4.6,
 * Etapas 5e and 5f). Shown in Preferências de notificação, which the account menu opens.
 */
const _label = (kind: Preference['kind'], channel: Preference['channel']): string =>
  SUMMARY_KINDS.has(kind) ? (channel === 'email' ? 'Receber por e-mail' : 'Não receber') : CHANNEL_LABEL[channel]

const preferenceRow = (preference: Preference): Html => html`
  <tr>
    <td><strong>${KIND_LABEL[preference.kind].label}</strong><p class="muted">${KIND_LABEL[preference.kind].hint}</p></td>
    <td>${selectField({ name: `channel-${preference.kind}`, label: `Como avisar: ${KIND_LABEL[preference.kind].label}`, visibleLabel: false, options: channelsOf(preference.kind).map((value) => ({ value, label: _label(preference.kind, value) })), value: preference.channel, attributes: html`data-preference="${preference.kind}"` })}</td>
  </tr>
`

/** Whether the person can be reached in Slack, and how to choose it. */
const slackLine = async (): Promise<Html> => {
  const status = await slackRead.status()
  const text = !status.workspace
    ? 'O Slack ainda não está conectado à organização.'
    : status.me?.found
      ? `Conectado a ${status.workspace.teamName}: escolha “JiraIA e Slack” nos avisos que quer receber lá.`
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

export const bindPreferences = (root: HTMLElement): void => {
  root.addEventListener('select-change', (event) => {
    const kind = (event.target as HTMLElement).closest<HTMLElement>('[data-preference]')?.dataset.preference
    if (kind) {
      const channel = (event as CustomEvent<{ value: string }>).detail.value as Preference['channel']
      void noticesWrite
        .setPreference(kind as Preference['kind'], channel)
        .then(() => toast('Preferência salva.'))
        .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    }
  })
}
