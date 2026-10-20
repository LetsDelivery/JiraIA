import { type Card, type Member, read, type SavedView, type SearchResult } from '@/api/requests'
import { contentPath } from '@/lib/draw'
import { type Html, html } from '@/lib/html'
import { mentionParts } from '@/lib/relations'
import { MATCH_LABEL, spaceKeyOf } from '@/lib/search'
import { spacePath } from '@/lib/space-types'
import { viewLabel } from '@/ui/filter-bar'
import { icon } from '@/ui/icons'

import type { View } from './view'

type Ref = SearchResult['items'][number]['card']

const cardHref = (key: string): string => `${spacePath(spaceKeyOf(key))}?card=${key}`

/** A comment's excerpt keeps its mentions as `<@id>`; on screen they read as names. */
const excerptOf = (text: string, names: ReadonlyMap<string, string>): Html =>
  html`${mentionParts(text).map((part) =>
    'text' in part ? part.text : html`<span class="mention">@${names.get(part.memberId) ?? 'alguém'}</span>`
  )}`

const refLine = (card: Ref, detail: Html): Html => html`
  <li class="search-result">
    <a class="search-result-link" href="${cardHref(card.key)}">
      <span class="card-key">${card.key}</span>
      <span class="search-result-title">${card.title}</span>
      <span class="state-chip"><span class="group-dot group-${card.state.group}" aria-hidden="true"></span>${card.state.name}</span>
    </a>
    ${detail}
  </li>
`

/** Pages and whiteboards of Let’s Draw AI whose title or text holds the query (ADR-0011). */
const contentResults = (contents: SearchResult['contents']): Html =>
  contents.length
    ? html`<p class="muted">${contents.length} no Let’s Draw AI</p>
      <ul class="search-results">${contents.map(
        (
          item
        ) => html`<li class="search-result"><a class="search-result-link" href="${contentPath(item.spaceId, item.id)}">
          ${icon(item.kind === 'whiteboard' ? 'chalkboard' : 'fileText', 16)}<span class="search-result-title">${item.title}</span>
          <span class="muted">${item.spaceName}</span></a><p class="muted search-excerpt">${item.excerpt}</p></li>`
      )}</ul>`
    : html``

const textResults = (query: string, found: SearchResult, members: readonly Member[]): Html => {
  const names = new Map(members.map((member) => [member.id, member.name]))
  if (!found.exact && found.items.length === 0 && found.contents.length === 0) {
    return html`<p class="empty muted">Nada encontrado para “${query}”.</p>`
  }
  return html`
    ${found.exact ? html`<p><a class="button button-secondary" href="${cardHref(found.exact.key)}">Ir para ${found.exact.key}</a></p>` : ''}
    ${contentResults(found.contents)}
    <p class="muted">${found.items.length} card${found.items.length === 1 ? '' : 's'}</p>
    <ul class="search-results">${found.items.map((item) =>
      refLine(
        item.card,
        item.match === 'title' || item.match === 'key'
          ? html`<p class="muted search-excerpt">${MATCH_LABEL[item.match]}</p>`
          : html`<p class="muted search-excerpt">${MATCH_LABEL[item.match]} · ${excerptOf(item.excerpt, names)}</p>`
      )
    )}</ul>
  `
}

const viewResults = (view: SavedView, cards: readonly Card[]): Html => html`
  <p class="muted">${cards.length} card${cards.length === 1 ? '' : 's'} em todos os espaços da visão</p>
  ${
    cards.length
      ? html`<ul class="search-results">${cards.map(
          (card) => html`<li class="search-result"><a class="search-result-link" href="${cardHref(card.key)}">
            <span class="card-key">${card.key}</span><span class="search-result-title">${card.title}</span>
            <span class="muted">${card.assignee?.name ?? 'Sem responsável'}</span></a></li>`
        )}</ul>`
      : html`<p class="empty muted">Nenhum card nesta visão agora.</p>`
  }
  <p class="muted">Visão de ${view.owner.name}.</p>
`

const viewList = (views: readonly SavedView[]): Html => html`
  <section class="section">
    <h2>Visões salvas</h2>
    ${
      views.length
        ? html`<ul class="search-results">${views.map(
            (view) => html`<li class="search-result"><a class="search-result-link" href="/busca?visao=${view.id}">
              ${icon('bookmark', 16)}<span class="search-result-title">${viewLabel(view)}</span></a></li>`
          )}</ul>`
        : html`<p class="muted">Nenhuma visão salva ainda. Filtre um board e use “Salvar visão”.</p>`
    }
  </section>
`

/**
 * Search across every space the caller reads (escopo-mvp 3.6): text in keys, titles, descriptions and
 * comments. `?visao=` runs a saved view across all of its spaces — "Por KR" spans REQ and PRD.
 */
export const searchView: View = {
  path: '/busca',
  title: 'Busca',
  render: async () => {
    const params = new URLSearchParams(location.search)
    const query = params.get('q')?.trim() ?? ''
    const viewId = params.get('visao')
    if (viewId) {
      const [view, cards] = await Promise.all([read.view(viewId), read.viewCards(viewId)])
      return html`<header class="page-header"><h1>${view.name}</h1></header>${viewResults(view, cards.items)}`
    }
    if (!query) {
      return html`<header class="page-header"><h1>Busca</h1></header>${viewList((await read.allViews()).items)}`
    }
    const [found, members] = await Promise.all([read.search(query), read.members()])
    return html`<header class="page-header"><h1>Busca: ${query}</h1></header>${textResults(query, found, members.items)}`
  }
}
