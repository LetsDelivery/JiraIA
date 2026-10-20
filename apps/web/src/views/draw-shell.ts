import type { Me } from '@/api/requests'
import { DRAW_HOME } from '@/lib/draw'
import { type Html, html } from '@/lib/html'

import { frame } from './shell'

/**
 * Let’s Draw AI's frame (ADR-0010, ADR-0011): its own brand, and the sidebar its screen draws — the
 * list of spaces at home, a space's content inside one.
 */
export const drawShell = (me: Me, sidebar: Html, path: string, content: Html, unread = 0) =>
  frame({
    me,
    unread,
    path,
    content,
    product: 'draw',
    brand: html`<a class="brand" href="${DRAW_HOME}">Let’s Draw <span>AI</span></a>`,
    nav: sidebar
  })
