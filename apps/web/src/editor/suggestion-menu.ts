import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'

import { type Html, html } from '@/lib/html'

/** One line of a suggestion menu: what it says, and a quieter word beside it. */
export type MenuItem = { label: string; hint?: string; icon?: Html }

/**
 * The floating list a typed `/`, `@` or `#` opens (escopo-mvp 5.2, 5.5): arrows move, Enter chooses,
 * Esc closes. Shared by the slash command, people and cards, so they look and behave alike.
 */
export const suggestionMenu = <T extends MenuItem>(label: string) => {
  let menu: HTMLElement | undefined
  let props: SuggestionProps<T> | undefined
  let active = 0

  const draw = () => {
    if (!menu || !props) {
      return
    }
    const items = props.items
    menu.innerHTML = items.length
      ? html`${items.map(
          (
            item,
            index
          ) => html`<li role="option" class="suggestion-item" data-index="${index}" aria-selected="${index === active}">
            ${item.icon ?? ''}<span>${item.label}</span>${item.hint ? html`<small>${item.hint}</small>` : ''}</li>`
        )}`.value
      : html`<li class="suggestion-empty">Nada encontrado</li>`.value
    void place()
  }

  const place = async () => {
    const rect = props?.clientRect?.()
    if (!menu || !rect) {
      return
    }
    const anchor = { getBoundingClientRect: () => rect }
    const { x, y } = await computePosition(anchor, menu, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [offset(6), flip(), shift({ padding: 8 })]
    })
    Object.assign(menu.style, { left: `${x}px`, top: `${y}px` })
  }

  const choose = (index: number) => {
    const item = props?.items[index]
    if (item) {
      props?.command(item)
    }
  }

  const Keys: Record<string, () => void> = {
    ArrowDown: () => {
      active = (active + 1) % Math.max(props?.items.length ?? 1, 1)
      draw()
    },
    ArrowUp: () => {
      const total = Math.max(props?.items.length ?? 1, 1)
      active = (active - 1 + total) % total
      draw()
    },
    Enter: () => choose(active)
  }

  return {
    onStart: (next: SuggestionProps<T>) => {
      props = next
      active = 0
      menu = document.createElement('ul')
      menu.className = 'select-menu glass suggestion-menu'
      menu.setAttribute('role', 'listbox')
      menu.setAttribute('aria-label', label)
      menu.addEventListener('mousedown', (event) => {
        event.preventDefault()
        const item = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
        choose(Number(item?.dataset.index ?? -1))
      })
      // Inside an open modal dialog — a card's comment — the body is under the dialog's top layer.
      const host = next.editor.view.dom.closest('dialog') ?? document.body
      host.append(menu)
      draw()
    },
    onUpdate: (next: SuggestionProps<T>) => {
      props = next
      active = Math.min(active, Math.max(next.items.length - 1, 0))
      draw()
    },
    onKeyDown: ({ event }: SuggestionKeyDownProps): boolean => {
      const action = Keys[event.key]
      action?.()
      return action !== undefined || event.key === 'Escape'
    },
    onExit: () => {
      menu?.remove()
      menu = undefined
      props = undefined
    }
  }
}
