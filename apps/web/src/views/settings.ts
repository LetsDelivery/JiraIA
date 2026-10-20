import { slackRead } from '@/api/slack'
import { type Html, html } from '@/lib/html'
import type { ThemeChoice } from '@/ui/account-menu'
import { icon } from '@/ui/icons'
import { bindPreferences, preferencesPanel } from '@/ui/notification-preferences'

import { applyTheme, theme } from './shell'
import type { View } from './view'

/**
 * A person's settings (Etapa 5e): how JiraIA looks for them, which notices they get and where, and
 * whether they are reached in Slack. Their own; nobody else's changes.
 */
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Seguir o sistema' }
]

const appearance = (current: ThemeChoice): Html => html`
  <section class="section">
    <h2>Aparência</h2>
    <div class="chips" role="radiogroup" aria-label="Tema">
      ${THEMES.map((each) => html`<button type="button" class="chip chip-toggle" role="radio" aria-checked="${current === each.value}" aria-pressed="${current === each.value}" data-settings-theme="${each.value}">${each.label}</button>`)}
    </div>
  </section>`

const slackLine = async (): Promise<Html> => {
  const status = await slackRead.status()
  const text = !status.workspace
    ? 'O Slack ainda não está conectado à organização.'
    : status.me?.found
      ? `Conectado a ${status.workspace.teamName}: escolha “JiraIA e Slack” nos avisos que quer receber lá.`
      : `Conectado a ${status.workspace.teamName}, mas não achamos você lá pelo seu e-mail.`
  return html`<p class="muted settings-slack">${icon('slack', 16)}${text} <a href="/slack">Ver a integração</a></p>`
}

export const settingsView: View = {
  path: '/configuracoes',
  title: 'Configurações da conta',
  render: async () => {
    const [notices, slack] = await Promise.all([preferencesPanel(), slackLine()])
    return html`
      <header class="page-header"><h1>Configurações da conta</h1><p class="muted">Só valem para você.</p></header>
      ${appearance(theme.get() ?? 'system')}
      <section class="section"><h2>Notificações</h2>${slack}${notices}</section>
    `
  },
  bind: (root) => {
    bindPreferences(root)
    root.querySelector('[role="radiogroup"]')?.addEventListener('click', (event) => {
      const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-settings-theme]')?.dataset
        .settingsTheme as ThemeChoice | undefined
      if (choice) {
        theme.set(choice === 'system' ? null : choice)
        applyTheme()
        for (const button of root.querySelectorAll<HTMLElement>('[data-settings-theme]')) {
          const on = button.dataset.settingsTheme === choice
          button.setAttribute('aria-checked', String(on))
          button.setAttribute('aria-pressed', String(on))
        }
      }
    })
  }
}
