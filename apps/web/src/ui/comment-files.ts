import type { Attachment } from '@/api/requests'
import { citations } from '@/lib/comment-files'
import { type Html, html } from '@/lib/html'

import { thumb } from './attachment-thumbs'
import { icon } from './icons'

const chip = (file: Attachment, index: number, block: boolean): Html => html`
  <button type="button" class="comment-file ${block ? 'is-block' : ''}" data-open-file="${index}" aria-label="Visualizar ${file.name}">
    ${thumb(file)}<span class="comment-file-name">${file.name}</span>
  </button>
`

/**
 * What the comment's editor shows for a cited file: the card's attachment as the comment will show it,
 * or its name while it is still going up.
 */
export const fileLook =
  (attachments: readonly Attachment[]) =>
  (name: string): HTMLElement => {
    const file = attachments.find((each) => each.name === name)
    const look = document.createElement('span')
    look.className = 'comment-file is-block'
    look.innerHTML = file
      ? html`${thumb(file)}<span class="comment-file-name">${name}</span>`.value
      : html`<span class="attachment-thumb attachment-glyph">${icon('fileUpload', 28)}</span><span class="comment-file-name">Enviando ${name}…</span>`
          .value
    return look
  }

const element = (markup: Html): Node => {
  const holder = document.createElement('template')
  holder.innerHTML = markup.value
  return holder.content
}

/** The text nodes of a comment, collected first: replacing them while walking would lose the walk. */
const texts = (body: HTMLElement): Text[] => {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const found: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    found.push(node as Text)
  }
  return found
}

/** A citation alone on its line is the picture, as Jira showed it; inside a sentence it is a chip. */
const _replace = (node: Text, attachments: readonly Attachment[], createdAt: string): void => {
  const value = node.data
  const found = citations(value, attachments, createdAt)
  const alone = found.length === 1 && value.trim().length === (found[0]?.end ?? 0) - (found[0]?.start ?? 0)
  const pieces = document.createDocumentFragment()
  let from = 0
  for (const { start, end, file } of found) {
    pieces.append(
      value.slice(from, start),
      element(chip(file, attachments.indexOf(file), alone && !node.previousSibling))
    )
    from = end
  }
  pieces.append(value.slice(from))
  node.replaceWith(pieces)
}

/**
 * Turns each `📎 name` of a drawn comment into the card's attachment of that name — the same rows
 * the Anexos panel lists, from JiraIA's own database and bucket. A name the card no longer has stays
 * as text.
 */
export const linkFiles = (body: HTMLElement, attachments: readonly Attachment[], createdAt: string): void => {
  for (const node of texts(body)) {
    if (citations(node.data, attachments, createdAt).length) {
      _replace(node, attachments, createdAt)
    }
  }
}
