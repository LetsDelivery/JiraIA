import { type Box, type Notice, noticesRead, noticesWrite } from '@/api/notifications'
import { forget } from '@/lib/cache'
import { type Html, html } from '@/lib/html'
import { sentence, snoozeUntil, target } from '@/lib/notifications'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { avatar } from '@/ui/avatar'
import { toggleFloatingMenu } from '@/ui/floating-menu'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'

import type { View } from './view'

const TABS: { tab: Box; label: string }[] = [
  { tab: 'inbox', label: 'Caixa de entrada' },
  { tab: 'snoozed', label: 'Adiadas' },
  { tab: 'archived', label: 'Arquivadas' }
]

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

const currentTab = (): Box => {
  const tab = new URLSearchParams(location.search).get('aba')
  return TABS.find((each) => each.tab === tab)?.tab ?? 'inbox'
}

const tabs = (current: Box, unread: number) => html`
  <nav class="tabs" aria-label="Notificações">
    ${TABS.map(
      ({ tab, label }) =>
        html`<a class="tab" href="/notificacoes${tab === 'inbox' ? '' : `?aba=${tab}`}" ${tab === current ? html`aria-current="page"` : ''}>${label}${tab === 'inbox' && unread ? html` <span class="count">${unread}</span>` : ''}</a>`
    )}
  </nav>
`

const actions = (notice: Notice, box: Box): Html => {
  if (box === 'archived') {
    return html`<button type="button" class="button button-ghost button-small" data-notice-action="unarchive">Desarquivar</button>`
  }
  if (box === 'snoozed') {
    return html`<button type="button" class="button button-ghost button-small" data-notice-action="wake">Trazer de volta</button>`
  }
  return html`
    <button type="button" class="button button-ghost button-icon" data-notice-action="${notice.readAt ? 'unread' : 'read'}" aria-label="${notice.readAt ? 'Marcar como não lida' : 'Marcar como lida'}" title="${notice.readAt ? 'Marcar como não lida' : 'Marcar como lida'}">${icon(notice.readAt ? 'eyeOff' : 'eye', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-notice-action="snooze" aria-haspopup="menu" aria-label="Adiar" title="Adiar">${icon('clockPause', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-notice-action="archive" aria-label="Arquivar" title="Arquivar">${icon('archive', 16)}</button>`
}

const noticeItem = (notice: Notice, box: Box): Html => html`
  <li class="notice ${notice.readAt ? '' : 'is-unread'}" data-notice="${notice.id}">
    <span class="notice-dot" aria-hidden="true"></span>
    ${avatar(notice.actor)}
    <div class="notice-text">
      <a class="notice-link" href="${target(notice)}" data-notice-open>${sentence(notice)}</a>
      ${notice.data.cardTitle || notice.data.excerpt ? html`<p class="muted notice-detail">${notice.data.excerpt ? `“${notice.data.excerpt}”` : notice.data.cardTitle}</p>` : ''}
      <p class="notice-when">${box === 'snoozed' && notice.snoozedUntil ? `Volta em ${WHEN.format(new Date(notice.snoozedUntil))}` : WHEN.format(new Date(notice.createdAt))}</p>
    </div>
    <div class="notice-actions">${actions(notice, box)}</div>
  </li>
`

const EMPTY: Record<Box, string> = {
  inbox: 'Nada novo por aqui.',
  snoozed: 'Nenhuma notificação adiada.',
  archived: 'Nenhuma notificação arquivada.'
}

/** The address the preferences had while they were a tab here, kept for links already saved. */
const _isOldPreferences = (): boolean => new URLSearchParams(location.search).get('aba') === 'preferencias'

/**
 * The Central de Notificações (escopo-mvp 4.6): what happened that concerns you, with read, snooze and
 * archive. Which notices come and where is a page of its own, linked from the header.
 */
export const notificationsView: View = {
  path: '/notificacoes',
  title: 'Central de Notificações',
  render: async () => {
    if (_isOldPreferences()) {
      return html``
    }
    const tab = currentTab()
    const inbox = await noticesRead.list(tab)
    const body = inbox.items.length
      ? html`<ul class="notice-list">${inbox.items.map((notice) => noticeItem(notice, tab))}</ul>`
      : html`<div class="empty"><p class="empty-title">${EMPTY[tab]}</p></div>`
    return html`
      <header class="page-header row">
        <h1>Central de Notificações</h1>
        <div class="row">
          ${tab === 'inbox' && inbox.unread ? html`<button type="button" class="button button-secondary" data-read-all>Marcar todas como lidas</button>` : ''}
          <a class="button button-ghost" href="/notificacoes/preferencias">${icon('settings', 16)}Preferências</a>
        </div>
      </header>
      ${tabs(tab, inbox.unread)}
      <section class="section notice-section">${body}</section>
    `
  },
  bind: (root) => (_isOldPreferences() ? navigate('/notificacoes/preferencias', true) : bindNotifications(root))
}

const SNOOZE_MENU = html`
  <button type="button" role="menuitem" data-snooze="tomorrow">${icon('clockPause', 16)}Amanhã às 8h</button>
  <button type="button" role="menuitem" data-snooze="next_week">${icon('calendar', 16)}Segunda-feira às 8h</button>
`

const CHANGE: Record<string, Parameters<typeof noticesWrite.update>[1]> = {
  read: { read: true },
  unread: { read: false },
  archive: { archived: true, read: true },
  unarchive: { archived: false },
  wake: { snoozedUntil: null }
}

const _act = (button: HTMLElement, id: string) => {
  const action = button.dataset.noticeAction ?? ''
  if (action !== 'snooze') {
    return noticesWrite.update(id, CHANGE[action] ?? {})
  }
  toggleFloatingMenu({
    anchor: button,
    label: 'Adiar até',
    className: 'draw-menu',
    content: SNOOZE_MENU,
    onClick: (clicked) => {
      const when = clicked.closest<HTMLElement>('[data-snooze]')?.dataset.snooze as 'tomorrow' | 'next_week' | undefined
      if (when) {
        void noticesWrite
          .update(id, { snoozedUntil: snoozeUntil(when, new Date()) })
          .then(() => toast('Notificação adiada.'))
      }
      return when === undefined
    }
  })
  return Promise.resolve()
}

const bindNotifications = (root: HTMLElement): void => {
  const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
  root.querySelector('[data-read-all]')?.addEventListener('click', () => void noticesWrite.readAll().catch(refuse))
  root.querySelector('.notice-list')?.addEventListener('click', (event) => {
    const element = event.target as HTMLElement
    const id = element.closest<HTMLElement>('[data-notice]')?.dataset.notice ?? ''
    const button = element.closest<HTMLElement>('[data-notice-action]')
    const link = element.closest<HTMLAnchorElement>('[data-notice-open]')
    if (button) {
      void _act(button, id).catch(refuse)
    } else if (link) {
      event.preventDefault()
      void noticesWrite.update(id, { read: true }).finally(() => navigate(link.getAttribute('href') ?? '/'))
    }
  })
}

/**
 * The bell's count, refreshed in place — never a whole redraw, which would take what someone is
 * typing with it. `main.ts` calls this every minute while the tab is visible.
 */
export const refreshBell = async (): Promise<void> => {
  forget('notifications:unread')
  const { unread } = await noticesRead.unread()
  const count = document.querySelector<HTMLElement>('[data-bell-count]')
  if (count) {
    count.hidden = unread === 0
    count.textContent = unread > 99 ? '99+' : String(unread)
    count.closest('[data-bell]')?.setAttribute('aria-label', `Notificações${unread ? `, ${unread} não lidas` : ''}`)
  }
}
