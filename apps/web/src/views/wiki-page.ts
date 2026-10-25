import { drawRead, drawWrite } from '@/api/draw'
import { type WikiPage, wikiRead, wikiWrite } from '@/api/wiki'
import { ancestorsOf } from '@/lib/content-tree'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { persistedStore } from '@/lib/store'
import { collectionPath, dayOf, wikiPagePath } from '@/lib/wiki'
import { childrenOf } from '@/lib/wiki-nav'
import { startingOn } from '@/ui/content-comments'
import { toggleFloatingMenu } from '@/ui/floating-menu'
import { icon } from '@/ui/icons'
import { openIconPicker, pageIconButton } from '@/ui/page-icon'
import { toast } from '@/ui/toast'
import { openChangeOwner, openPublishToWiki } from '@/ui/wiki-dialogs'
import { copyLink, glyph, mark } from '@/ui/wiki-marks'

import {
  bindDocument,
  bindFolder,
  closeEditors,
  documentScreen,
  folderScreen,
  type Loaded,
  loadContent,
  loadEditors
} from './draw-content'
import type { View } from './view'
import { bindWikiSidebar, wikiSidebar } from './wiki-sidebar'

/**
 * A page of a collection (wiki-navegacao.md, "Página"): Draw's editor (ADR-0033) under a top bar with
 * the whole path and the page's actions, its icon and state over the title, its subpages after the
 * text, and the comments in a panel that opens and closes.
 */

/** Whether the comments panel is open, per viewer, on this browser; closed, the text takes the reading width. */
const commentsOpen = persistedStore('jiraia.wiki.comments-open', false)

const versionsAsked = (): boolean => new URLSearchParams(location.search).get('painel') === 'versoes'

/** What the caller may do about the page: confirm its review, change its state, hand it on — or publish it. */
const pageActions = (page: WikiPage): Html => {
  const official = page.state === 'official'
  return html`<span class="wiki-bar-actions">
    ${page.canReview && official ? html`<button type="button" class="button button-secondary button-small" data-wiki-review>${icon('circleCheck', 16)}Confirmar revisão</button>` : ''}
    ${page.canManage && !page.personal ? html`<button type="button" class="button button-ghost button-small" data-wiki-official="${String(!official)}">${official ? 'Voltar a rascunho' : 'Tornar oficial'}</button>` : ''}
    ${page.personal ? html`<button type="button" class="button button-ghost button-small" data-wiki-publish>${icon('books', 16)}Publicar numa coleção</button>` : ''}
  </span>`
}

const reviewNote = (page: WikiPage): Html =>
  page.reviewedAt && page.reviewDue
    ? html`<span class="muted">Revisada em ${dayOf(page.reviewedAt)} · vale até ${dayOf(page.reviewDue)}</span>`
    : html``

/** The band over the title: the page's mark, its owner, its review, and what the caller may do. */
const stateBand = (page: WikiPage): Html => html`
  <div class="wiki-bar" role="region" aria-label="Estado da página">
    ${page.personal ? html`<span class="badge">Pessoal</span>` : mark(page)}
    <span class="muted">Responsável: <strong>${page.owner.name}</strong></span>
    ${reviewNote(page)}
    ${pageActions(page)}
  </div>
`

const crumbs = (data: Loaded): Html => {
  const { spaceId, id, title } = data.content
  return html`<nav class="breadcrumbs wiki-crumbs" aria-label="Caminho">
    <a href="${collectionPath(spaceId)}">${data.spaceName}</a>
    ${ancestorsOf(data.nodes, id).map((node) => html`<span aria-hidden="true">›</span><a href="${wikiPagePath(spaceId, node.id)}">${node.title}</a>`)}
    <span aria-hidden="true">›</span><span class="wiki-crumb-current" aria-current="page">${title}</span>
  </nav>`
}

const topButton = (attribute: Html, glyphName: Parameters<typeof icon>[0], label: string, pressed?: boolean) =>
  html`<button type="button" class="button button-ghost button-icon" ${attribute} aria-label="${label}" title="${label}" ${pressed === undefined ? '' : html`aria-pressed="${pressed}"`}>${icon(glyphName, 18)}</button>`

/** The fixed top: the path, who else is here, copy link, star, comments and the "⋯" menu. */
const topBar = (data: Loaded, page: WikiPage, comments: number, open: boolean): Html => html`
  <div class="wiki-page-top">
    ${crumbs(data)}
    <div class="wiki-page-top-actions">
      <span class="page-presence" data-presence></span>
      ${topButton(html`data-copy-link`, 'link', 'Copiar link')}
      ${topButton(html`data-wiki-favorite`, page.favorite ? 'starFilled' : 'star', page.favorite ? 'Tirar das favoritas' : 'Favoritar', page.favorite)}
      <button type="button" class="button button-ghost wiki-comments-toggle" data-toggle-comments aria-pressed="${open}" aria-label="${open ? 'Fechar' : 'Abrir'} comentários" title="Comentários">${icon('message', 18)}${comments ? html`<span class="count">${comments}</span>` : ''}</button>
      <button type="button" class="button button-ghost button-icon" data-page-menu aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações" title="Mais ações">${icon('dots', 18)}</button>
    </div>
  </div>
`

/** The page's own pages, listed after the text, to move on without the sidebar. */
const subpages = (data: Loaded): Html => {
  const children = childrenOf(data.nodes, data.content.id)
  return children.length
    ? html`<section class="wiki-subpages" aria-label="Subpáginas"><h2 class="section-title">Subpáginas</h2>
        <ul class="search-results">${children.map(
          (node) =>
            html`<li class="search-result"><a class="search-result-link" href="${wikiPagePath(data.content.spaceId, node.id)}">${glyph(node)}<span class="search-result-title">${node.title}</span></a></li>`
        )}</ul></section>`
    : html``
}

/** What render read, for bind. */
let loaded: { data: Loaded; page?: WikiPage | undefined } | undefined

const renderPage = async (data: Loaded): Promise<Html> => {
  const [page, comments] = await Promise.all([
    wikiRead.page(data.content.id),
    drawRead.comments(data.content.id),
    loadEditors()
  ])
  loaded = { data, page }
  const open = commentsOpen.get() || versionsAsked() || startingOn(data.content.id)
  const waiting = comments.items.filter((each) => !each.parentId && !each.resolvedAt).length
  return await documentScreen(data, {
    top: topBar(data, page, waiting, open),
    overTitle: html`${pageIconButton(data.content.icon, data.content.canWrite)}${stateBand(page)}`,
    after: subpages(data),
    panelOpen: open,
    tabbedComments: true
  })
}

export const wikiPageView: View = {
  path: '/wiki/:collectionId/:contentId',
  skeleton: 'document',
  title: 'Página',
  area: 'wiki',
  sidebar: async ({ collectionId = '', contentId = '' }) =>
    await wikiSidebar(wikiPagePath(collectionId, contentId), collectionId, contentId),
  bindSidebar: (sidebar) => bindWikiSidebar(sidebar),
  enter: async ({ contentId = '' }) => {
    await drawWrite.visit(contentId).catch(() => undefined)
  },
  render: async ({ collectionId = '', contentId = '' }) => {
    const data = await loadContent(collectionId, contentId, 'wiki')
    if (data.content.kind === 'folder') {
      loaded = { data }
      return folderScreen(data)
    }
    return await renderPage(data)
  },
  bind: (root) => {
    if (loaded?.page) {
      bindPage(root, loaded.page, loaded.data)
      bindDocument(root, loaded.data)
    } else if (loaded) {
      bindFolder(root, loaded.data)
    }
  },
  leave: () => closeEditors()
}

const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')

/** Opens or closes the comments beside the text, and remembers it. */
const setPanel = (root: HTMLElement, open: boolean): void => {
  commentsOpen.set(open)
  root.querySelector('.page-layout')?.classList.toggle('is-panel-closed', !open)
  const button = root.querySelector<HTMLElement>('[data-toggle-comments]')
  button?.setAttribute('aria-pressed', String(open))
  button?.setAttribute('aria-label', `${open ? 'Fechar' : 'Abrir'} comentários`)
}

const removePage = async (data: Loaded): Promise<void> => {
  if (confirm(`Excluir "${data.content.title}"?`)) {
    await drawWrite.remove({ id: data.content.id, spaceId: data.content.spaceId })
    navigate(collectionPath(data.content.spaceId))
  }
}

const pageMenu = (page: WikiPage, data: Loaded): Html => html`
  <button type="button" role="menuitem" data-page-action="versions">${icon('history', 16)}Versões</button>
  ${page.personal ? html`<button type="button" role="menuitem" data-page-action="publish">${icon('books', 16)}Publicar numa coleção</button>` : ''}
  ${page.canReview ? html`<button type="button" role="menuitem" data-page-action="owner">${icon('user', 16)}Trocar responsável</button>` : ''}
  ${data.content.canWrite ? html`<button type="button" role="menuitem" data-page-action="delete">${icon('trash', 16)}Excluir</button>` : ''}
`

const PAGE_ACTIONS: Record<string, (page: WikiPage, data: Loaded, root: HTMLElement) => Promise<unknown> | undefined> =
  {
    versions: (_page, data, root) => {
      setPanel(root, true)
      navigate(`${wikiPagePath(data.content.spaceId, data.content.id)}?painel=versoes`)
      return undefined
    },
    publish: (_page, data) => openPublishToWiki(data.content, 'personal'),
    owner: (page, data) => {
      openChangeOwner(page, data.members)
      return undefined
    },
    delete: (_page, data) => removePage(data)
  }

const openPageMenu = (root: HTMLElement, button: HTMLElement, page: WikiPage, data: Loaded): void =>
  toggleFloatingMenu({
    anchor: button,
    label: 'Ações da página',
    className: 'draw-menu',
    placement: 'bottom-end',
    content: pageMenu(page, data),
    onClick: (target) => {
      const action = target.closest<HTMLElement>('[data-page-action]')?.dataset.pageAction
      void Promise.resolve(action ? PAGE_ACTIONS[action]?.(page, data, root) : undefined).catch(refuse)
      return action === undefined
    }
  })

const BAR_ACTIONS: Record<string, (page: WikiPage, target: HTMLElement, data: Loaded) => Promise<unknown> | undefined> =
  {
    'data-wiki-review': (page) => wikiWrite.review(page).then(() => toast('Revisão confirmada.')),
    'data-wiki-official': (page, target) => {
      const official = target.dataset.wikiOfficial === 'true'
      return wikiWrite
        .setOfficial(page, official)
        .then(() => toast(official ? 'A página agora é oficial.' : 'A página voltou a rascunho.'))
    },
    'data-wiki-publish': (_page, _target, data) => openPublishToWiki(data.content, 'personal'),
    'data-wiki-favorite': (page) => wikiWrite.setFavorite(page, !page.favorite),
    'data-copy-link': (_page, _target, data) => {
      copyLink(wikiPagePath(data.content.spaceId, data.content.id))
      return undefined
    }
  }

const chooseIcon = (page: WikiPage, emoji: string | null): void => {
  wikiWrite.setIcon(page, emoji).catch(refuse)
}

const bindPage = (root: HTMLElement, page: WikiPage, data: Loaded): void => {
  for (const [attribute, act] of Object.entries(BAR_ACTIONS)) {
    root.querySelector<HTMLElement>(`[${attribute}]`)?.addEventListener('click', (event) => {
      void Promise.resolve(act(page, event.currentTarget as HTMLElement, data)).catch(refuse)
    })
  }
  root.querySelector('[data-toggle-comments]')?.addEventListener('click', () => setPanel(root, !commentsOpen.get()))
  root.addEventListener('thread-focus', () => setPanel(root, true))
  const menu = root.querySelector<HTMLElement>('[data-page-menu]')
  menu?.addEventListener('click', () => openPageMenu(root, menu, page, data))
  const iconButton = root.querySelector<HTMLElement>('[data-page-icon]')
  iconButton?.addEventListener('click', () =>
    openIconPicker(iconButton, data.content.icon, (emoji) => chooseIcon(page, emoji))
  )
}
