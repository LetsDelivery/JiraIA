import { type ContentNode, type DrawSpace, drawRead, drawWrite, type RecentContent } from '@/api/draw'
import { read } from '@/api/requests'
import { contentPath, drawSpacePath } from '@/lib/draw'
import { type Html, html } from '@/lib/html'
import { accessPanel, bindAccessPanel } from '@/ui/access-panel'
import { openCreateMenu } from '@/ui/create-menu'
import { openCreateDrawSpace } from '@/ui/draw-space-dialogs'
import { icon } from '@/ui/icons'
import { bindEditNotice, editNotice } from '@/ui/request-access'

import {
  bindDocument,
  bindFolder,
  closeEditors,
  documentScreen,
  folderScreen,
  type Loaded,
  loadContent,
  loadEditors
} from './draw-content'
import { bindHomeSidebar, bindSpaceSidebar, homeSidebar, spaceSidebar } from './draw-sidebar'
import { canCreateSpaces } from './shell'
import type { View } from './view'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

const recentList = (items: readonly RecentContent[]): Html =>
  items.length
    ? html`<ul class="search-results">${items.map(
        (
          item
        ) => html`<li class="search-result"><a class="search-result-link" href="${contentPath(item.spaceId, item.id)}">
          ${icon(item.kind === 'whiteboard' ? 'chalkboard' : 'fileText', 16)}<span class="search-result-title">${item.title}</span>
          <span class="muted">${item.spaceIcon} ${item.spaceName}</span><span class="muted data">${WHEN.format(new Date(item.updatedAt))}</span></a></li>`
      )}</ul>`
    : html`<p class="empty muted">Nada criado ainda. Abra um espaço e crie a primeira página.</p>`

const spaceCard = (space: DrawSpace): Html => html`
  <a class="draw-space-card" href="${drawSpacePath(space.id)}">
    <span class="draw-space-icon draw-space-icon-large" aria-hidden="true">${space.icon}</span>
    <strong>${space.name}</strong>
    <span class="muted">${space.description || 'Sem descrição'}</span>
  </a>
`

/** LET’S Draw AI's home (ADR-0010, ADR-0012): the spaces — admins and space managers create them — and what changed last. */
export const drawHomeView: View = {
  path: '/draw',
  title: 'Início',
  area: 'draw',
  sidebar: async () => await homeSidebar('/draw'),
  bindSidebar: (sidebar) => bindHomeSidebar(sidebar),
  render: async () => {
    const [me, recent, opened, spaces] = await Promise.all([
      read.me(),
      drawRead.recent(),
      drawRead.opened(),
      drawRead.spaces()
    ])
    return html`
      <header class="page-header"><div class="row"><h1>LET’S Draw AI</h1>
        ${canCreateSpaces(me) ? html`<button type="button" class="button button-primary" data-new-draw-space>${icon('plus', 16)}Criar espaço</button>` : ''}</div>
        <p class="muted">Processos, specs, atas e quadros das equipes da LET’S.</p></header>
      <section class="section"><h2>Espaços</h2>
        ${spaces.items.length ? html`<div class="draw-space-grid">${spaces.items.map(spaceCard)}</div>` : html`<p class="empty muted">Nenhum espaço ainda.</p>`}
      </section>
      ${opened.items.length ? html`<section class="section"><h2>Abertos por você</h2>${recentList(opened.items)}</section>` : ''}
      <section class="section"><h2>Alterados recentemente</h2>${recentList(recent.items)}</section>
    `
  },
  bind: (root) => {
    root.querySelector('[data-new-draw-space]')?.addEventListener('click', () => openCreateDrawSpace())
  }
}

/** A space's front page: what it is for, and its top-level content. */
export const drawSpaceView: View = {
  path: '/draw/:spaceId',
  title: 'Espaço',
  area: 'draw',
  sidebar: async ({ spaceId = '' }) => await spaceSidebar(spaceId),
  bindSidebar: (sidebar) => bindSpaceSidebar(sidebar),
  render: async ({ spaceId = '' }) => {
    const [space, tree, notice] = await Promise.all([
      drawRead.space(spaceId),
      drawRead.tree(spaceId),
      editNotice('draw', spaceId)
    ])
    const top = tree.items.filter((node) => node.parentId === null).sort((a, b) => a.position - b.position)
    const people = peopleTab()
    return html`
      <header class="page-header"><div class="row"><span class="draw-space-icon draw-space-icon-large" aria-hidden="true">${space.icon}</span><h1>${space.name}</h1>
        ${space.canWrite && !people ? html`<button type="button" class="button button-primary" data-create-here>${icon('plus', 16)}Criar</button>` : ''}</div>
        ${space.description ? html`<p class="muted">${space.description}</p>` : ''}</header>
      ${notice}
      ${people ? html`<h2 class="section-title">Pessoas e papéis</h2>${await accessPanel('draw', spaceId)}` : topList(space, top)}
    `
  },
  bind: (root, { spaceId = '' }) => {
    bindEditNotice(root, 'draw', spaceId)
    if (peopleTab()) {
      bindAccessPanel(root, 'draw', spaceId)
    }
    root
      .querySelector<HTMLElement>('[data-create-here]')
      ?.addEventListener('click', (event) => openCreateMenu(event.currentTarget as HTMLElement, { spaceId }))
  }
}

/** `?aba=pessoas` opens who holds which role, from the space's menu. */
const peopleTab = (): boolean => new URLSearchParams(location.search).get('aba') === 'pessoas'

const topList = (space: DrawSpace, top: readonly ContentNode[]): Html =>
  html`${
    top.length
      ? html`<ul class="search-results">${top.map(
          (
            node
          ) => html`<li class="search-result"><a class="search-result-link" href="${contentPath(space.id, node.id)}">
                ${icon(node.kind === 'folder' ? 'folder' : node.kind === 'page' ? 'fileText' : 'chalkboard', 16)}
                <span class="search-result-title">${node.title}</span></a></li>`
        )}</ul>`
      : html`<p class="empty muted">O espaço está vazio. Crie uma pasta, uma página, um quadro — ou descreva o que quer e a IA monta.</p>`
  }`

/** What render read, for bind. */
let loaded: Loaded | undefined

/** A folder, a page or a whiteboard of a space (escopo-mvp 5.1–5.7, ADR-0011). */
export const drawContentView: View = {
  path: '/draw/:spaceId/:contentId',
  skeleton: 'document',
  title: 'Conteúdo',
  area: 'draw',
  sidebar: async ({ spaceId = '', contentId = '' }) => await spaceSidebar(spaceId, contentId),
  bindSidebar: (sidebar) => bindSpaceSidebar(sidebar),
  // "Abertos por você" counts a page or a whiteboard once per opening, not per redraw.
  enter: async ({ contentId = '' }) => {
    await drawWrite.visit(contentId).catch(() => undefined)
  },
  render: async ({ spaceId = '', contentId = '' }) => {
    loaded = await loadContent(spaceId, contentId)
    const notice = await editNotice('draw', spaceId)
    if (loaded.content.kind === 'folder') {
      return html`${notice}${folderScreen(loaded)}`
    }
    await loadEditors()
    return html`${notice}${await documentScreen(loaded)}`
  },
  bind: (root, { spaceId = '' }) => {
    bindEditNotice(root, 'draw', spaceId)
    if (loaded?.content.kind === 'folder') {
      bindFolder(root, loaded)
    } else if (loaded) {
      bindDocument(root, loaded)
    }
  },
  leave: () => closeEditors()
}
