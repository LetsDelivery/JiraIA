import type { Me } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { WIKI_HOME } from '@/lib/wiki'

import { frame } from './shell'

/**
 * LET’S Wiki's frame (ADR-0033): its own brand, and the sidebar its screen draws — home, reviews,
 * the collections and, inside one, its pages.
 */
export const wikiShell = (me: Me, sidebar: Html, path: string, content: Html, unread = 0) =>
  frame({
    me,
    unread,
    path,
    content,
    product: 'wiki',
    brand: html`<a class="brand" href="${WIKI_HOME}">LET’S <span>Wiki</span></a>`,
    nav: sidebar
  })
