import { read } from '@/api/requests'
import { type Collection, type RecentWikiPage, type ReviewItem, wikiRead } from '@/api/wiki'
import { type Html, html } from '@/lib/html'
import { navigate } from '@/lib/router'
import { collectionPath, dayOf, type PageMark, WIKI_COLLECTIONS, WIKI_REVIEWS, wikiPagePath } from '@/lib/wiki'
import { icon } from '@/ui/icons'
import { openCreateCollection } from '@/ui/wiki-dialogs'
import { glyph, lockOf, mark } from '@/ui/wiki-marks'

import type { View } from './view'
import { bindWikiSidebar, wikiSidebar } from './wiki-sidebar'

const pageLine = (href: string, title: string, page: PageMark & { icon?: string | null }, after: Html = html``): Html =>
  html`<li class="search-result"><a class="search-result-link" href="${href}">
    ${glyph(page)}<span class="search-result-title">${title}</span>${mark(page)}${after}</a></li>`

const collectionCard = (collection: Collection): Html => html`
  <a class="draw-space-card" href="${collectionPath(collection.id)}">
    <span class="draw-space-icon draw-space-icon-large" aria-hidden="true">${collection.icon}</span>
    <strong>${collection.name} ${lockOf(collection.access)}</strong>
    <span class="muted">${collection.description || 'Sem descrição'}</span>
  </a>
`

const recentList = (items: readonly RecentWikiPage[]): Html =>
  items.length
    ? html`<ul class="search-results">${items.map((item) =>
        pageLine(
          wikiPagePath(item.collectionId, item.contentId),
          item.title,
          item,
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
      <section class="section"><div class="row wiki-section-head"><h2>Coleções</h2><a class="button button-ghost button-small" href="${WIKI_COLLECTIONS}">Ver todas</a></div>
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
