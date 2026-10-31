// The font from the entry file rather than a CSS `@import`, which some bundlers do not resolve.
import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/cards.css'
import './styles/viewer.css'
import './styles/sprints.css'
import './styles/card-detail.css'
import './styles/intake.css'
import './styles/search.css'
import './styles/pages.css'
import './styles/page-tools.css'
import './styles/products.css'
import './styles/draw.css'
import './styles/wiki.css'
import './styles/wiki-page.css'
import './styles/access.css'
import './styles/governance.css'
import './styles/reports.css'
import './styles/whiteboard.css'
import './styles/account.css'
import './styles/proposals.css'
import './styles/settings.css'
import './styles/oauth.css'
import './styles/loading.css'
import './styles/responsive.css'
import '@fontsource/caveat/400.css'

import { warmer } from '@/api/client'
import { noticesRead } from '@/api/notifications'
import { proposalsRead } from '@/api/proposals'
import { read } from '@/api/requests'
import { session, signOut, signOutEverywhere } from '@/auth/session'
import { clearCache, invalidate, onInvalidate } from '@/lib/cache'
import { html } from '@/lib/html'
import { presence, watchPresence } from '@/lib/presence'
import { refusalSentence } from '@/lib/refusal'
import { rememberReturn, takeReturn } from '@/lib/return-to'
import { findRoute, interceptLinks, navigate, onNavigate } from '@/lib/router'
import { cardKey, spaceKeyOf } from '@/lib/search'
import { spacePath } from '@/lib/space-types'
import { accountMenu, type ThemeChoice } from '@/ui/account-menu'
import { bindAvatarFallback } from '@/ui/avatar'
import { bindCardPicker } from '@/ui/card-picker'
import { openCreateCard } from '@/ui/create-card'
import { toggleFloatingMenu } from '@/ui/floating-menu'
import { holdPlace, markCurrent } from '@/ui/pending'
import { bindSelects, closeSelectsOnOutsideClick } from '@/ui/select'
import { openCreateSpace } from '@/ui/space-dialogs'
import { PRODUCT_NAME, productOf, splash } from '@/ui/splash'
import { bindStars } from '@/ui/star'
import {
  accessQueueView,
  accessReportView,
  accessReviewsView,
  accessSystemsView,
  heldAccessView,
  myAccessView
} from '@/views/access'
import { drawContentView, drawHomeView, drawSpaceView } from '@/views/draw'
import { drawShell } from '@/views/draw-shell'
import { forYouView } from '@/views/for-you'
import { formPageView } from '@/views/form-page'
import { githubConnectView, githubView } from '@/views/github'
import { groupsView } from '@/views/groups'
import { integrationsView } from '@/views/integrations'
import { notificationsView, refreshBell } from '@/views/notifications'
import { oauthConsentView } from '@/views/oauth-consent'
import { peopleView } from '@/views/people'
import { profileView } from '@/views/profile'
import { proposalsView } from '@/views/proposals'
import { searchView } from '@/views/search'
import { notificationPreferencesView, settingsView } from '@/views/settings'
import { applyTheme, appsMenu, collapsed, isDark, shell, spacesOpen, theme, toggleSection } from '@/views/shell'
import { bindSignIn, signInPage } from '@/views/sign-in'
import { slackConnectView, slackView } from '@/views/slack'
import { spaceView } from '@/views/space'
import { spaceSettingsHomeView, spaceSettingsView } from '@/views/space-settings'
import { spacesView } from '@/views/spaces'
import type { View } from '@/views/view'
import { wikiHomeView, wikiReviewsView } from '@/views/wiki'
import { wikiCollectionView } from '@/views/wiki-collection'
import { wikiCollectionsView } from '@/views/wiki-collections'
import { wikiPageView } from '@/views/wiki-page'
import { wikiShell } from '@/views/wiki-shell'

/**
 * The panel, in plain JavaScript (ADR-0006): a router picks a view, the view renders markup from
 * cached API reads, and any write that changes cached data re-renders what is on screen.
 */
const ROUTES: readonly View[] = [
  forYouView,
  spacesView,
  spaceView,
  spaceSettingsView,
  spaceSettingsHomeView,
  peopleView,
  groupsView,
  myAccessView,
  accessQueueView,
  heldAccessView,
  accessSystemsView,
  accessReviewsView,
  accessReportView,
  integrationsView,
  notificationsView,
  notificationPreferencesView,
  proposalsView,
  oauthConsentView,
  settingsView,
  slackConnectView,
  slackView,
  githubConnectView,
  githubView,
  profileView,
  formPageView,
  searchView,
  drawHomeView,
  drawSpaceView,
  drawContentView,
  wikiHomeView,
  // Before a collection's address, which has the same shape.
  wikiReviewsView,
  wikiCollectionsView,
  wikiCollectionView,
  wikiPageView
]

const app = document.getElementById('app') as HTMLElement

/** Each render takes a ticket; a slower, older render that finishes late is dropped. */
let ticket = 0

/** The screen on display and its params, so leaving it lets it clean up (an open editor, a socket). */
let shown: { route: View; key: string } | undefined

/** Whether another screen — or the same one with other params — is going in; the old one is left. */
const leaveIfChanged = (route: View, params: Record<string, string>): boolean => {
  const key = JSON.stringify(params)
  const changed = !shown || shown.route !== route || shown.key !== key
  if (shown && changed) {
    shown.route.leave?.()
  }
  shown = { route, key }
  return changed
}

/**
 * A navigation answers at once: the menu item is marked, and a screen slow to load shows its skeleton
 * (`holdPlace`). A re-render after a change, or a tab of the same screen, keeps what is on screen.
 */
const holdScreen = (route: View, path: string, mine: number) => {
  markCurrent(app.querySelector('.sidebar'), path)
  return holdPlace(app.querySelector('#view'), route.skeleton, () => mine === ticket)
}

const cardHref = (key: string): string => `${spacePath(spaceKeyOf(key))}?card=${key}`

/** A card suggested under the search box opens straight away, as a typed key does. */
const bindGlobalSearch = () => {
  const form = app.querySelector<HTMLElement>('[data-global-search]')
  if (form) {
    bindCardPicker(form, { accept: () => true, onPick: (card) => navigate(cardHref(card.key)) })
  }
}

const renderSignIn = () => {
  app.innerHTML = signInPage().value
  document.title = 'Entrar · JiraIA'
  bindSignIn(app)
}

const renderApp = async (path: string, entering: boolean) => {
  const mine = ++ticket
  const match = findRoute(ROUTES, path)
  if (!match) {
    navigate('/', true)
    return
  }
  const placeholder = leaveIfChanged(match.route, match.params) ? holdScreen(match.route, path, mine) : undefined
  if (entering) {
    await match.route.enter?.(match.params).catch(() => undefined)
  }

  const refused = (refusal: unknown) => html`<p class="muted">${refusalSentence(refusal)}</p>`
  // The photos are known before any screen draws a person (ADR-0039); read once, then cached.
  await read.members().catch(() => undefined)
  const [me, spaces, all, content, sidebar, notices, proposals] = await Promise.all([
    read.me(),
    read.mySpaces(),
    read.spaces(),
    match.route.render(match.params).catch(refused),
    match.route.sidebar?.(match.params).catch(refused),
    noticesRead.unread().catch(() => ({ unread: 0 })),
    proposalsRead.pendingCount().catch(() => ({ pending: 0 }))
  ])
  await placeholder?.settle()
  if (mine !== ticket) {
    return
  }

  // Three products, one panel (ADR-0010, ADR-0033): each screen sits in its own product's frame.
  const area = match.route.area ?? 'jiraia'
  const frames = {
    draw: () => drawShell(me, sidebar ?? html``, path, content, notices.unread),
    wiki: () => wikiShell(me, sidebar ?? html``, path, content, notices.unread),
    jiraia: () => shell(me, spaces, all.items, path, content, notices.unread, proposals.pending)
  }
  app.innerHTML = frames[area]().value
  // A re-render from a change keeps the drawer as it was; a navigation closes it (`onNavigate`).
  setDrawer(drawerOpen)
  document.title = `${match.route.title} · ${PRODUCT_NAME[area]}`
  const view = app.querySelector<HTMLElement>('#view') as HTMLElement
  bindSelects(view)
  bindGlobalSearch()
  match.route.bind?.(view, match.params)
  match.route.bindSidebar?.(app.querySelector('.sidebar .nav') as HTMLElement, match.params)
}

/**
 * Whether the tab opened on this page already signed out — a link someone followed, a consent page an
 * application sent them to. Only then is the page kept to return to; signing out never keeps one.
 */
let openedSignedOut = !session.get()

const render = (entering = false) => {
  const path = location.pathname
  const firstSignedOut = openedSignedOut
  openedSignedOut = false
  if (!session.get()) {
    if (path !== '/entrar') {
      if (firstSignedOut) {
        rememberReturn(sessionStorage, `${path}${location.search}`)
      }
      navigate('/entrar', true)
      return
    }
    renderSignIn()
    return
  }
  if (path === '/entrar') {
    navigate(takeReturn(sessionStorage), true)
    return
  }
  if (!app.querySelector('.shell')) {
    app.innerHTML = splash(path).value
    document.title = PRODUCT_NAME[productOf(path)]
  }
  renderApp(path, entering).catch(() => {
    // `/work/me` refused: an expired token was already signed out by the API client; anything else
    // is shown on the sign-in screen rather than as a half-drawn app.
    signOut()
  })
}

const themeChoice = (): ThemeChoice => theme.get() ?? 'system'

/** What a choice in the account menu does; answering `true` keeps the menu open. */
const onAccountChoice = (target: HTMLElement): boolean | undefined => {
  const choice = target.closest<HTMLElement>('[data-theme-choice]')?.dataset.themeChoice as ThemeChoice | undefined
  if (choice) {
    theme.set(choice === 'system' ? null : choice)
    applyTheme()
    render()
  } else if (target.closest('[data-sign-out]') || target.closest('[data-switch-account]')) {
    // Signing out forgets the Google account chosen, so the sign-in screen offers every account again.
    signOut()
  }
  return undefined
}

const openAccountMenu = async (): Promise<void> => {
  const anchor = app.querySelector<HTMLElement>('[data-account]')
  if (anchor) {
    const me = await read.me()
    toggleFloatingMenu({
      anchor,
      label: 'Sua conta',
      className: 'account-menu',
      placement: 'bottom-end',
      content: accountMenu(me, themeChoice()),
      onClick: onAccountChoice
    })
  }
}

/** Controls that belong to the frame, not to a screen: sign out, theme, collapse. */
const FRAME_ACTIONS: Record<string, (control: HTMLElement) => void> = {
  '[data-sign-out]': () => signOutEverywhere(),
  '[data-theme-toggle]': () => {
    theme.set(isDark() ? 'light' : 'dark')
    applyTheme()
    render()
  },
  '[data-new-space]': () => void openCreateSpace(),
  '[data-create-card-anywhere]': () => void openCreateCard(),
  '[data-toggle-spaces]': () => {
    // From the icon-only sidebar, opening Espaços also brings the sidebar back.
    const opening = collapsed.get() || !spacesOpen.get()
    collapsed.set(false)
    spacesOpen.set(opening)
    render()
  },
  '[data-toggle-section]': (control) => {
    toggleSection(control.dataset.toggleSection ?? '')
    render()
  },
  '[data-account]': () => void openAccountMenu(),
  '[data-apps]': () => {
    const anchor = app.querySelector<HTMLElement>('[data-apps]') as HTMLElement
    const product = app.querySelector<HTMLElement>('.shell')?.dataset.product ?? 'jiraia'
    toggleFloatingMenu({
      anchor,
      label: 'Produtos',
      className: 'draw-menu',
      content: appsMenu(product),
      onClick: () => undefined
    })
  },
  '[data-collapse]': () => {
    // On a phone the menu is a drawer over the page; from a tablet up it folds to its icons.
    if (isPhone()) {
      setDrawer(!app.querySelector('.shell')?.classList.contains('is-drawer-open'))
      return
    }
    collapsed.set(!collapsed.get())
    app.querySelector('.shell')?.classList.toggle('is-collapsed', collapsed.get())
  },
  '[data-close-drawer]': () => setDrawer(false),
  '[data-open-search]': () => setSearching(true),
  '[data-close-search]': () => setSearching(false)
}

/** The width under which the sidebar is a drawer and the search an icon — `components.css` agrees. */
const isPhone = (): boolean => matchMedia('(max-width: 760px)').matches

/** Whether the phone's drawer is open — kept across re-renders, closed by a navigation. */
let drawerOpen = false

const setDrawer = (open: boolean): void => {
  drawerOpen = open
  app.querySelector('.shell')?.classList.toggle('is-drawer-open', open)
  app.querySelector('[data-collapse]')?.setAttribute('aria-expanded', String(open))
}

const setSearching = (open: boolean): void => {
  app.querySelector('.topbar')?.classList.toggle('is-searching', open)
  if (open) {
    app.querySelector<HTMLInputElement>('#global-search')?.focus()
  }
}

/** A key goes straight to its card — even one from before the card moved (2.14); text goes to /busca. */
const search = async (text: string): Promise<void> => {
  const key = cardKey(text)
  const card = key ? await read.cardByKey(key).catch(() => undefined) : undefined
  navigate(card ? cardHref(card.key) : `/busca?q=${encodeURIComponent(text)}`)
}

/** `/` anywhere but in a field focuses the search box, as in Jira and GitHub. */
const focusSearchOnSlash = (event: KeyboardEvent) => {
  const typing = (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')
  if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    setSearching(true)
  }
}

/** Escape closes what the phone's frame opened: the drawer, the search over the header. */
const closeFrameOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && (drawerOpen || app.querySelector('.topbar.is-searching'))) {
    setDrawer(false)
    setSearching(false)
  }
}

const bindFrame = () => {
  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const action = Object.entries(FRAME_ACTIONS).find(([selector]) => target.closest(selector))
    action?.[1](target.closest(action[0]) as HTMLElement)
  })
  app.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-global-search]')
    const text = String(form ? new FormData(form).get('q') : '').trim()
    if (form) {
      event.preventDefault()
      if (text) {
        void search(text)
      }
    }
  })
  document.addEventListener('keydown', focusSearchOnSlash)
  document.addEventListener('keydown', closeFrameOnEscape)
}

applyTheme()
interceptLinks(document.body)
closeSelectsOnOutsideClick()
bindStars(app)
bindFrame()
bindAvatarFallback(document, () => invalidate('members', 'me'))
onNavigate(() => {
  drawerOpen = false
  render(true)
})

// The bell keeps up with new notices between renders (escopo-mvp 4.6), only while someone is at the
// panel: a tab left alone lets the database pause, and the bell catches up when they are back. Their
// first sign after a quiet spell sets a paused database resuming before they click (ADR-0035).
watchPresence(() => warmer.nudge())
const ringBell = () => {
  if (session.get()) {
    void refreshBell().catch(() => undefined)
  }
}
setInterval(() => {
  if (presence.isHere()) {
    ringBell()
  } else {
    presence.onReturn(ringBell)
  }
}, 60_000)
onInvalidate(() => render())
session.subscribe((value) => {
  if (!value) {
    clearCache()
  }
  render(true)
})
render(true)
