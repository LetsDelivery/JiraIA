import { html } from '@/lib/html'
import { navigate } from '@/lib/router'
import { bindPreferences, preferencesPanel } from '@/ui/notification-preferences'

import type { View } from './view'

const PATH = '/notificacoes/preferencias'

/**
 * Which notices a person gets and where (escopo-mvp 4.6, Etapas 5e and 5f) — only that: the inbox is
 * the Central de Notificações, the theme is in the account menu. Their own; nobody else's changes.
 */
export const notificationPreferencesView: View = {
  path: PATH,
  title: 'Preferências de notificação',
  render: async () => html`
    <header class="page-header">
      <h1>Preferências de notificação</h1>
      <p class="muted">Só valem para você. Os avisos ficam na <a href="/notificacoes">Central de Notificações</a>.</p>
    </header>
    <section class="section">${await preferencesPanel()}</section>
  `,
  bind: (root) => bindPreferences(root)
}

/** The old Configurações da conta (Etapa 5e): its address only sends a saved link to the preferences. */
export const settingsView: View = {
  path: '/configuracoes',
  title: 'Preferências de notificação',
  render: async () => html``,
  bind: () => navigate(PATH, true)
}
