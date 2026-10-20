import { noticesRead, noticesWrite, type Preference } from '@/api/notifications'
import { type Html, html } from '@/lib/html'
import { CHANNEL_LABEL, KIND_LABEL } from '@/lib/notifications'
import { refusalSentence } from '@/lib/refusal'

import { selectField } from './select'
import { toast } from './toast'

/**
 * What each kind of notice does — panel only, the daily e-mail, Slack, or nothing (escopo-mvp 4.6,
 * Etapa 5e). Shown in Notificações → Preferências and in Configurações da conta.
 */
const preferenceRow = (preference: Preference): Html => html`
  <tr>
    <td><strong>${KIND_LABEL[preference.kind].label}</strong><p class="muted">${KIND_LABEL[preference.kind].hint}</p></td>
    <td>${selectField({ name: `channel-${preference.kind}`, label: `Como avisar: ${KIND_LABEL[preference.kind].label}`, visibleLabel: false, options: Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label })), value: preference.channel, attributes: html`data-preference="${preference.kind}"` })}</td>
  </tr>
`

export const preferencesPanel = async (): Promise<Html> => {
  const { items } = await noticesRead.preferences()
  return html`
    <p class="muted">O e-mail diário chega às 8h com o que você ainda não leu. No Slack, o aviso chega na hora, por mensagem direta.</p>
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
