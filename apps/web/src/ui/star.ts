import { write } from '@/api/requests'
import { html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'

import { icon } from './icons'
import { toast } from './toast'

/** A star button. Its click is handled once, for the whole app, by `bindStars`. */
export const starButton = (space: { id: string; name: string; starred: boolean }) => {
  const label = space.starred ? `Remover estrela de ${space.name}` : `Marcar ${space.name} com estrela`

  return html`
    <button
      type="button"
      class="button button-ghost button-icon star ${space.starred ? 'is-starred' : ''}"
      data-star="${space.id}"
      data-starred="${space.starred}"
      aria-pressed="${space.starred}"
      aria-label="${label}"
      title="${label}"
    >
      ${icon(space.starred ? 'starFilled' : 'star')}
    </button>
  `
}

/** Stars live inside links (a space card), so the click must not follow the link. */
export const bindStars = (root: HTMLElement): void => {
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-star]')
    if (!button) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    write
      .star(button.dataset.star ?? '', button.dataset.starred !== 'true')
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  })
}
