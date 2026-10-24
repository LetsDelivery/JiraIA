import { drawWrite } from '@/api/draw'
import { read } from '@/api/requests'
import {
  type Collection,
  type RecentWikiPage,
  type ReviewItem,
  type WikiNode,
  type WikiPage,
  wikiRead,
  wikiWrite
} from '@/api/wiki'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { collectionPath, dayOf, type PageMark, pageMark, WIKI_REVIEWS, wikiPagePath } from '@/lib/wiki'
import { accessPanel, bindAccessPanel } from '@/ui/access-panel'
import { openCreateMenu } from '@/ui/create-menu'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { openChangeOwner, openCollectionSettings, openCreateCollection } from '@/ui/wiki-dialogs'

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

const TONE_CLASS = { draft: '', official: 'badge-on', due: 'badge-warn', overdue: 'badge-danger' } as const

/** A page's mark — Rascunho, Oficial, Revisar até…, Revisão vencida — as one badge. */
const mark = (page: PageMark): Html => {
  const { tone, label } = pageMark(page)
  return html`<span class="badge wiki-mark ${TONE_CLASS[tone]}">${label}</span>`
}

const pageLine = (href: string, title: string, page: PageMark, after: Html = html``): Html =>
  html`<li class="search-result"><a class="search-result-link" href="${href}">
    ${icon('fileText', 16)}<span class="search-result-title">${title}</span>${mark(page)}${after}</a></li>`

const collectionCard = (collection: Collection): Html => html`
  <a class="draw-space-card" href="${collectionPath(collection.id)}">
    <span class="draw-space-icon draw-space-icon-large" aria-hidden="true">${collection.icon}</span>
    <strong>${collection.name}</strong>
    <span class="muted">${collection.description || 'Sem descrição'}</span>
  </a>
`

const recentList = (items: readonly RecentWikiPage[]): Html =>
  items.length
    ? html`<ul class="search-results">${items.map((item) =>
        pageLine(
          wikiPagePath(item.collectionId, item.contentId),
          item.title,
          { ...item, reviewDue: null },
          html`<span class="muted">${item.collectionIcon} ${item.collectionName}</span>`
        )
      )}</ul>`
    : html`<p class="empty muted">Nenhuma página ainda. Abra uma coleção e escreva a primeira.</p>`

/** "Pergunte ou busque": the search of the whole panel, which finds wiki pages and says where they live. */
const askBox = html`
  <form class="wiki-ask" data-wiki-ask role="search">
    <label class="sr-only" for="wiki-ask">Pergunte ou busque na wiki</label>
    ${icon('search', 18)}<input id="wiki-ask" type="search" class="input" name="q" autocomplete="off" placeholder="O que você quer saber?" />
  </form>
`

/** "N páginas suas pedem revisão", on the home of whoever has some. */
const dueLink = (count: number): Html => {
  if (count === 0) {
    return html``
  }
  const text = count === 1 ? '1 página sua pede revisão' : `${count} páginas suas pedem revisão`
  return html`<p class="wiki-due"><a href="${WIKI_REVIEWS}">${icon('calendarCheck', 16)}${text}</a></p>`
}

/** The wiki's home (ADR-0033): the question first, then the collections and what changed last. */
export const wikiHomeView: View = {
  path: '/wiki',
  title: 'Início',
  area: 'wiki',
  sidebar: async () => await wikiSidebar('/wiki'),
  bindSidebar: (sidebar) => bindWikiSidebar(sidebar),
  render: async () => {
    const [me, collections, recent, reviews] = await Promise.all([
      read.me(),
      wikiRead.collections(),
      wikiRead.recent(),
      wikiRead.reviews()
    ])
    return html`
      <header class="page-header"><div class="row"><h1>LET’S Wiki</h1>
        ${me.isOrgAdmin ? html`<button type="button" class="button button-primary" data-new-collection>${icon('plus', 16)}Criar coleção</button>` : ''}</div>
        <p class="muted">O que vale na LET’S e nos seus clientes — cada página com responsável e data de revisão.</p></header>
      ${askBox}
      ${dueLink(reviews.items.length)}
      <section class="section"><h2>Coleções</h2>
        ${collections.items.length ? html`<div class="draw-space-grid">${collections.items.map(collectionCard)}</div>` : html`<p class="empty muted">Nenhuma coleção ainda.</p>`}
      </section>
      <section class="section"><h2>Atualizadas recentemente</h2>${recentList(recent.items)}</section>
    `
  },
  bind: (root) => {
    root.querySelector('[data-new-collection]')?.addEventListener('click', () => openCreateCollection())
    root.querySelector<HTMLFormElement>('[data-wiki-ask]')?.addEventListener('submit', (event) => {
      event.preventDefault()
      const query = String(new FormData(event.currentTarget as HTMLFormElement).get('q') ?? '').trim()
      if (query) {
        navigate(`/busca?q=${encodeURIComponent(query)}`)
      }
    })
  }
}

const reviewLine = (item: ReviewItem): Html =>
  pageLine(
    wikiPagePath(item.collectionId, item.contentId),
    item.title,
    { state: 'official', reviewDue: item.reviewDue, overdue: item.overdue },
    html`<span class="muted">${item.collectionName} · até ${dayOf(item.reviewDue)}</span>`
  )

/** The caller's official pages whose review date is near or past, soonest first. */
export const wikiReviewsView: View = {
  path: '/wiki/revisoes',
  title: 'Minhas revisões',
  area: 'wiki',
  sidebar: async () => await wikiSidebar(WIKI_REVIEWS),
  bindSidebar: (sidebar) => bindWikiSidebar(sidebar),
  render: async () => {
    const reviews = await wikiRead.reviews()
    return html`
      <header class="page-header"><h1>Minhas revisões</h1>
        <p class="muted">Páginas oficiais de que você é responsável, vencidas ou vencendo nos próximos 14 dias. Abra, confira e confirme a revisão.</p></header>
      ${reviews.items.length ? html`<ul class="search-results">${reviews.items.map(reviewLine)}</ul>` : html`<p class="empty muted">Nada para revisar agora.</p>`}
    `
  }
}

/** `?aba=pessoas` shows the collection's owners (admins) and editors (members). */
const peopleTab = (): boolean => new URLSearchParams(location.search).get('aba') === 'pessoas'

const collectionMeta = (collection: Collection): Html => html`
  <p class="muted wiki-meta">Revisão a cada ${collection.reviewDays} dias${collection.outline === 'customer' ? ' · Páginas novas começam pela ficha de cliente' : ''}
    · <a href="${collectionPath(collection.id)}?aba=pessoas">Donos e editores</a></p>
`

const topPages = (collection: Collection, nodes: readonly WikiNode[]): Html => {
  const top = nodes.filter((node) => node.parentId === null).sort((a, b) => a.position - b.position)
  if (!top.length) {
    return html`<p class="empty muted">A coleção está vazia.${collection.canWrite ? ' Crie a primeira página.' : ''}</p>`
  }
  return html`<ul class="search-results">${top.map((node) =>
    node.kind === 'folder'
      ? html`<li class="search-result"><a class="search-result-link" href="${wikiPagePath(collection.id, node.id)}">${icon('folder', 16)}<span class="search-result-title">${node.title}</span></a></li>`
      : pageLine(wikiPagePath(collection.id, node.id), node.title, { ...node, reviewDue: null })
  )}</ul>`
}

/** A collection's front page: what it holds, how often its pages are reviewed, and who owns it. */
export const wikiCollectionView: View = {
  path: '/wiki/:collectionId',
  title: 'Coleção',
  area: 'wiki',
  sidebar: async ({ collectionId = '' }) => await wikiSidebar(collectionPath(collectionId), collectionId),
  bindSidebar: (sidebar) => bindWikiSidebar(sidebar),
  render: async ({ collectionId = '' }) => {
    const [collection, tree] = await Promise.all([wikiRead.collection(collectionId), wikiRead.tree(collectionId)])
    const people = peopleTab()
    return html`
      <header class="page-header"><div class="row wiki-head"><span class="draw-space-icon draw-space-icon-large" aria-hidden="true">${collection.icon}</span><h1>${collection.name}</h1>
        ${collection.canManage ? html`<button type="button" class="button button-ghost" data-collection-settings>${icon('settings', 16)}Configurações</button>` : ''}
        ${collection.canWrite && !people ? html`<button type="button" class="button button-primary" data-create-here>${icon('plus', 16)}Criar</button>` : ''}</div>
        ${collection.description ? html`<p class="muted">${collection.description}</p>` : ''}
        ${collectionMeta(collection)}</header>
      ${people ? html`<h2 class="section-title">Donos e editores</h2><p class="muted">Administradores são os donos: tornam páginas oficiais. Membros editam.</p>${await accessPanel('draw', collectionId)}` : topPages(collection, tree.items)}
    `
  },
  bind: (root, { collectionId = '' }) => {
    if (peopleTab()) {
      bindAccessPanel(root, 'draw', collectionId)
    }
    root.querySelector('[data-collection-settings]')?.addEventListener('click', () => {
      void wikiRead.collection(collectionId).then(openCollectionSettings)
    })
    root
      .querySelector<HTMLElement>('[data-create-here]')
      ?.addEventListener('click', (event) =>
        openCreateMenu(event.currentTarget as HTMLElement, { spaceId: collectionId, area: 'wiki' })
      )
  }
}

/** What the caller may do about the page: confirm its review, change its state, hand it on. */
const pageActions = (page: WikiPage): Html => {
  const official = page.state === 'official'
  return html`<span class="wiki-bar-actions">
    ${page.canReview && official ? html`<button type="button" class="button button-secondary" data-wiki-review>${icon('circleCheck', 16)}Confirmar revisão</button>` : ''}
    ${page.canManage ? html`<button type="button" class="button button-ghost" data-wiki-official="${String(!official)}">${official ? 'Voltar a rascunho' : 'Tornar oficial'}</button>` : ''}
    ${page.canReview ? html`<button type="button" class="button button-ghost" data-wiki-owner>Trocar responsável</button>` : ''}
  </span>`
}

const reviewNote = (page: WikiPage): Html =>
  page.reviewedAt && page.reviewDue
    ? html`<span class="muted">Revisada em ${dayOf(page.reviewedAt)} · vale até ${dayOf(page.reviewDue)}</span>`
    : html``

/** The bar over a wiki page: its mark, its owner, its review — and what the caller may do about them. */
const pageBar = (page: WikiPage): Html => html`
  <div class="wiki-bar" role="region" aria-label="Estado da página">
    ${mark(page)}
    <span class="muted">Responsável: <strong>${page.owner.name}</strong></span>
    ${reviewNote(page)}
    ${pageActions(page)}
  </div>
`

const WIKI_ACTIONS: Record<
  string,
  (page: WikiPage, target: HTMLElement, data: Loaded) => Promise<unknown> | undefined
> = {
  'data-wiki-review': (page) => wikiWrite.review(page).then(() => toast('Revisão confirmada.')),
  'data-wiki-official': (page, target) =>
    wikiWrite
      .setOfficial(page, target.dataset.wikiOfficial === 'true')
      .then(() =>
        toast(target.dataset.wikiOfficial === 'true' ? 'A página agora é oficial.' : 'A página voltou a rascunho.')
      ),
  'data-wiki-owner': (page, _target, data) => {
    openChangeOwner(page, data.members)
    return undefined
  }
}

const bindPageBar = (root: HTMLElement, page: WikiPage, data: Loaded): void => {
  for (const [attribute, act] of Object.entries(WIKI_ACTIONS)) {
    root.querySelector<HTMLElement>(`[${attribute}]`)?.addEventListener('click', (event) => {
      const done = act(page, event.currentTarget as HTMLElement, data)
      void Promise.resolve(done).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    })
  }
}

/** What render read, for bind. */
let loaded: { data: Loaded; page?: WikiPage | undefined } | undefined

/** A folder or a page of a collection: Draw's editor, under the page's mark and review (ADR-0033). */
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
    const [page] = await Promise.all([wikiRead.page(contentId), loadEditors()])
    loaded = { data, page }
    return html`${pageBar(page)}${await documentScreen(data)}`
  },
  bind: (root) => {
    if (loaded?.page) {
      bindPageBar(root, loaded.page, loaded.data)
      bindDocument(root, loaded.data)
    } else if (loaded) {
      bindFolder(root, loaded.data)
    }
  },
  leave: () => closeEditors()
}
