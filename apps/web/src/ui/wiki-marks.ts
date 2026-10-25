import type { WikiLine } from '@/api/wiki'
import { initials } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { ACCESS_LABEL, type Access, type PageMark, pageMark, wikiPagePath } from '@/lib/wiki'

import { type IconName, icon } from './icons'
import { toast } from './toast'

/** The small marks LET’S Wiki's screens share: a page's state, a collection's access, a page's glyph. */

const TONE_CLASS = { draft: '', official: 'badge-on', due: 'badge-warn', overdue: 'badge-danger' } as const

/** A page's mark — Rascunho, Oficial, Revisar até…, Revisão vencida — as one badge. */
export const mark = (page: PageMark): Html => {
  const { tone, label } = pageMark(page)
  return html`<span class="badge wiki-mark ${TONE_CLASS[tone]}">${label}</span>`
}

const ACCESS_ICON: Record<Access, IconName> = { organization: 'world', restricted: 'lock', personal: 'user' }

/** "Toda a LET’S", "Restrita" or "Pessoal", with its icon. */
export const accessBadge = (access: Access): Html =>
  html`<span class="badge wiki-access wiki-access-${access}">${icon(ACCESS_ICON[access], 12)}${ACCESS_LABEL[access]}</span>`

/** A padlock beside a collection only some people read. */
export const lockOf = (access: Access): Html =>
  access === 'organization'
    ? html``
    : html`<span class="wiki-lock" aria-label="${ACCESS_LABEL[access]}" title="${ACCESS_LABEL[access]}">${icon('lock', 12)}</span>`

const KIND_ICON: Record<string, IconName> = { folder: 'folder', page: 'fileText', whiteboard: 'chalkboard' }

/** The page's emoji, or its kind's icon when it has none. */
export const glyph = (node: { icon?: string | null; kind?: string }, size = 16): Html =>
  node.icon
    ? html`<span class="wiki-emoji" aria-hidden="true">${node.icon}</span>`
    : html`<span class="wiki-glyph" aria-hidden="true">${icon(KIND_ICON[node.kind ?? 'page'] ?? 'fileText', size)}</span>`

/** A person as the tables show one: initials in a circle, then the name. */
export const person = (who: { name: string }): Html =>
  html`<span class="wiki-person"><span class="avatar" aria-hidden="true">${initials(who.name)}</span><span class="wiki-person-name">${who.name}</span></span>`

/** A page in a list of pages from any collection: icon, title, its collection, its mark. */
export const lineItem = (item: WikiLine): Html => html`
  <li class="search-result" data-name="${item.title}"><a class="search-result-link" href="${wikiPagePath(item.collectionId, item.contentId)}">
    ${glyph(item)}<span class="search-result-title">${item.title}</span>
    <span class="muted wiki-line-where">${item.collectionIcon} ${item.collectionName}</span>${mark(item)}</a></li>
`

/** Copies a wiki address, whole, for pasting elsewhere. */
export const copyLink = (path: string): void => {
  navigator.clipboard
    .writeText(`${location.origin}${path}`)
    .then(() => toast('Link copiado.'))
    .catch(() => toast('Não foi possível copiar o link.', 'error'))
}
