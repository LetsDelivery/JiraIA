import { type Html, html } from '@/lib/html'

import { closeFloatingMenu, toggleFloatingMenu } from './floating-menu'
import { icon } from './icons'

/**
 * A page's icon (wiki-navegacao.md, "Página"): an optional emoji over its title. Clicking it opens a
 * small set to choose from, a field for any other emoji, and a way to remove it.
 */

const EMOJIS = '📄 📘 📚 📌 📎 📝 ✅ ⚠️ 💡 🎯 🚀 🔒 🔑 ⚙️ 🧭 🗺️ 🚚 📦 🏢 🤝 💬 📞 📊 💰 🧾 🛠️ 🧪 📅 ⭐ ❤️ 🌱 🔥'.split(' ')

/** The emoji over the title, or — for who edits the page — a quiet "Adicionar ícone". */
export const pageIconButton = (current: string | null | undefined, canWrite: boolean): Html => {
  if (current) {
    return canWrite
      ? html`<button type="button" class="page-icon" data-page-icon aria-haspopup="menu" aria-expanded="false" aria-label="Trocar o ícone da página" title="Trocar ou remover o ícone">${current}</button>`
      : html`<span class="page-icon" aria-hidden="true">${current}</span>`
  }
  return canWrite
    ? html`<button type="button" class="button button-ghost button-small page-icon-add" data-page-icon aria-haspopup="menu" aria-expanded="false">${icon('moodSmile', 16)}Adicionar ícone</button>`
    : html``
}

const picker = (current: string | null | undefined): Html => html`
  <div class="emoji-grid" role="group" aria-label="Emojis">
    ${EMOJIS.map((emoji) => html`<button type="button" class="emoji-option" data-emoji="${emoji}" aria-pressed="${emoji === current}" aria-label="${emoji}">${emoji}</button>`)}
  </div>
  <form class="emoji-other" data-emoji-other>
    <label class="sr-only" for="emoji-other">Outro emoji</label>
    <input id="emoji-other" class="input" name="emoji" maxlength="8" placeholder="Outro emoji" autocomplete="off" />
    <button type="submit" class="button button-secondary button-small">Usar</button>
  </form>
  ${current ? html`<button type="button" role="menuitem" data-emoji-remove>${icon('trash', 16)}Remover ícone</button>` : ''}
`

/** Opens the set under the icon; `choose` gets the emoji picked, or `null` to remove it. */
export const openIconPicker = (
  anchor: HTMLElement,
  current: string | null | undefined,
  choose: (emoji: string | null) => void
): void => {
  toggleFloatingMenu({
    anchor,
    label: 'Ícone da página',
    className: 'draw-menu emoji-menu',
    content: picker(current),
    onClick: (target) => {
      const emoji = target.closest<HTMLElement>('[data-emoji]')?.dataset.emoji
      const remove = target.closest('[data-emoji-remove]')
      if (emoji || remove) {
        choose(emoji ?? null)
      }
      return !(emoji || remove)
    }
  })
  document.querySelector<HTMLFormElement>('[data-emoji-other]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const typed = String(new FormData(event.currentTarget as HTMLFormElement).get('emoji') ?? '').trim()
    if (typed) {
      closeFloatingMenu()
      choose(typed)
    }
  })
}
