import { computePosition, flip, offset, shift } from '@floating-ui/dom'

import type { Html } from '@/lib/html'

/**
 * A menu that floats over the page from the button that opened it. It lives in `<body>`: the glass
 * sidebar sets `backdrop-filter`, which makes it the containing block of anything fixed inside it, so a
 * menu kept there would be placed — and cut — by the sidebar instead of the window.
 */
let open: { menu: HTMLElement; anchor: HTMLElement } | undefined

export const closeFloatingMenu = (): void => {
  if (!open) {
    return
  }
  open.anchor.setAttribute('aria-expanded', 'false')
  open.anchor.classList.remove('is-open')
  open.menu.remove()
  open = undefined
  document.removeEventListener('click', onOutside, true)
  document.removeEventListener('keydown', onEscape)
}

function onOutside(event: MouseEvent) {
  const target = event.target as Node
  if (open && !open.menu.contains(target) && !open.anchor.contains(target)) {
    closeFloatingMenu()
  }
}

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    const anchor = open?.anchor
    closeFloatingMenu()
    anchor?.focus()
  }
}

export type FloatingMenu = {
  anchor: HTMLElement
  label: string
  className?: string
  role?: 'menu' | 'group'
  content: Html
  /** A click inside the menu; answering `true` keeps the menu open (a toggle that is not a choice). */
  onClick: (target: HTMLElement) => boolean | undefined
  /** Under the anchor's start by default; a control at the right edge opens toward the left. */
  placement?: 'bottom-start' | 'bottom-end'
}

/** Opens the menu, or closes it when its own button is pressed again. */
export const toggleFloatingMenu = (options: FloatingMenu): void => {
  if (open?.anchor === options.anchor) {
    closeFloatingMenu()
    return
  }
  closeFloatingMenu()
  const menu = document.createElement('div')
  menu.className = `select-menu glass floating-menu ${options.className ?? ''}`
  menu.setAttribute('role', options.role ?? 'menu')
  menu.setAttribute('aria-label', options.label)
  menu.innerHTML = options.content.value
  document.body.append(menu)
  open = { menu, anchor: options.anchor }
  options.anchor.setAttribute('aria-expanded', 'true')
  options.anchor.classList.add('is-open')
  void computePosition(options.anchor, menu, {
    strategy: 'fixed',
    placement: options.placement ?? 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })]
  }).then(({ x, y }) => Object.assign(menu.style, { left: `${x}px`, top: `${y}px` }))
  menu.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    if (!options.onClick(target)) {
      closeFloatingMenu()
    }
  })
  menu.querySelector<HTMLElement>('button')?.focus()
  document.addEventListener('click', onOutside, true)
  document.addEventListener('keydown', onEscape)
}
