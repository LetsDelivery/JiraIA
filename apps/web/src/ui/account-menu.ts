import type { Me } from '@/api/requests'
import { type Html, html } from '@/lib/html'

import { avatar } from './avatar'
import { icon } from './icons'

/**
 * The account menu (Etapa 5e): the person's avatar at the right end of the header opens who they are,
 * their profile and settings, the theme, Slack and GitHub, and the way out — what the bottom of the
 * side menu held.
 */
export type ThemeChoice = 'light' | 'dark' | 'system'

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Seguir o sistema' }
]

const accountAvatar = (me: Me, size: 'small' | 'large'): Html => avatar(me, `account-avatar account-avatar-${size}`)

export const accountButton = (me: Me): Html => html`
  <button type="button" class="account-button" data-account aria-haspopup="menu" aria-expanded="false" aria-label="Sua conta: ${me.name}" title="${me.name}">
    ${accountAvatar(me, 'small')}
  </button>
`

export const accountMenu = (me: Me, theme: ThemeChoice): Html => html`
  <div class="account-head">
    ${accountAvatar(me, 'large')}
    <div><strong>${me.name}</strong><span class="muted">${me.email ?? ''}</span></div>
  </div>
  <a role="menuitem" href="/perfil">${icon('user', 16)}Perfil</a>
  <a role="menuitem" href="/configuracoes">${icon('settings', 16)}Configurações da conta</a>
  <div class="account-group" role="group" aria-label="Tema">
    <span class="account-group-label">${icon(theme === 'dark' ? 'moon' : 'sun', 16)}Tema</span>
    ${THEMES.map(
      (each) =>
        html`<button type="button" role="menuitemradio" aria-checked="${theme === each.value}" data-theme-choice="${each.value}">${each.label}</button>`
    )}
  </div>
  <a role="menuitem" href="/slack">${icon('slack', 16)}Slack</a>
  <a role="menuitem" href="/github">${icon('github', 16)}GitHub</a>
  <hr class="account-rule" />
  <button type="button" role="menuitem" data-switch-account>${icon('arrowsExchange', 16)}Trocar de conta</button>
  <button type="button" role="menuitem" data-sign-out>${icon('logout', 16)}Sair</button>
`
