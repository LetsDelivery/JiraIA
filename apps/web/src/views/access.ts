import { type AccessSystem, type Entitlement, governanceRead, governanceWrite } from '@/api/governance'
import { type Me, read } from '@/api/requests'
import { isOpen, waitsOnMe } from '@/lib/governance'
import { type Html, html } from '@/lib/html'
import {
  entitlementRow,
  openAskAccess,
  openCompletion,
  openDecision,
  openRemoval,
  requestRow
} from '@/ui/access-governance'
import { icon } from '@/ui/icons'

import { bindSystems, on, systemsSection } from './access-systems'
import type { View } from './view'

/**
 * Access governance (ADR-0024): what one holds and asked for, the queue of whoever answers for a
 * system, what is held now, and the catalog. Unlike spaces, nothing here is open to everyone: the API
 * returns only what concerns the caller.
 */
const answersForSomething = (me: Me, systems: readonly AccessSystem[]): boolean =>
  me.isOrgAdmin || me.isAccessAuditor || systems.some((system) => system.duties.length > 0)

const tabs = async (path: string): Promise<Html> => {
  const [me, systems, requests] = await Promise.all([read.me(), governanceRead.systems(), governanceRead.requests()])
  const waiting = requests.items.filter(waitsOnMe).length
  const tab = (href: string, label: string, extra: Html | string = '') =>
    html`<a class="tab" href="${href}" ${href === path ? html`aria-current="page"` : ''}>${label}${extra}</a>`
  return html`
    <header class="page-header row">
      <h1>Acessos</h1>
      <button type="button" class="button button-primary" data-ask>${icon('plus')}Pedir acesso</button>
    </header>
    <nav class="tabs access-tabs" aria-label="Acessos">
      ${tab('/acessos', 'Meus acessos')}
      ${answersForSomething(me, systems.items) ? html`${tab('/acessos/fila', 'Fila', waiting ? html`<span class="nav-count" aria-label="${waiting} esperando você">${waiting}</span>` : '')}${tab('/acessos/vigentes', 'Vigentes')}` : ''}
      ${tab('/acessos/sistemas', 'Sistemas')}
    </nav>
  `
}

const list = (items: readonly Html[], empty: string): Html =>
  items.length ? html`<ul class="access-list">${items}</ul>` : html`<p class="muted">${empty}</p>`

const bindRows = (root: HTMLElement) => {
  on(root, 'ask', async () => openAskAccess(await read.me()))
  on(root, 'approve', async (button) => openDecision(button.dataset.approve ?? '', true))
  on(root, 'decline', async (button) => openDecision(button.dataset.decline ?? '', false))
  on(root, 'complete', async (button) => openCompletion(button.dataset.complete ?? ''))
  on(root, 'cancel', async (button) => {
    if (confirm('Cancelar este pedido? Ele fica no histórico como cancelado.')) {
      await governanceWrite.cancel(button.dataset.cancel ?? '')
    }
  })
  on(root, 'remove', async (button) => {
    const held = await governanceRead.held()
    const entitlement = held.items.find((each: Entitlement) => each.id === button.dataset.remove)
    if (entitlement) {
      openRemoval(entitlement)
    }
  })
}

export const myAccessView: View = {
  path: '/acessos',
  title: 'Meus acessos',
  render: async () => {
    const me = await read.me()
    const [held, requests] = await Promise.all([governanceRead.mine(me.id), governanceRead.requests()])
    const mine = requests.items.filter((each) => each.beneficiary.id === me.id || each.requester.id === me.id)
    return html`
      ${await tabs('/acessos')}
      <section class="section">
        <h2>O que você tem</h2>
        ${list(
          held.items.map((each) => entitlementRow(each, { showMember: false, canRemove: true })),
          'Nenhum acesso registrado. Na LET’S, cada acesso começa por um pedido.'
        )}
      </section>
      <section class="section">
        <h2>Seus pedidos</h2>
        ${list(mine.map(requestRow), 'Nenhum pedido ainda.')}
      </section>
    `
  },
  bind: bindRows
}

/** The nearest deadline first; a grant still waiting for approval has none yet and goes last. */
const byDeadline = <T extends { dueAt: string | null }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))

export const accessQueueView: View = {
  path: '/acessos/fila',
  title: 'Fila de acessos',
  render: async () => {
    const requests = (await governanceRead.requests()).items
    const forMe = byDeadline(requests.filter(waitsOnMe))
    const open = byDeadline(requests.filter((each) => isOpen(each) && !waitsOnMe(each)))
    const closed = requests.filter((each) => !isOpen(each)).slice(0, 50)
    return html`
      ${await tabs('/acessos/fila')}
      <section class="section"><h2>Esperando você</h2>${list(forMe.map(requestRow), 'Nada esperando você.')}</section>
      <section class="section"><h2>Em andamento</h2>${list(open.map(requestRow), 'Nenhum outro pedido em andamento.')}</section>
      <section class="section"><h2>Encerrados</h2>${list(closed.map(requestRow), 'Nenhum pedido encerrado.')}</section>
    `
  },
  bind: bindRows
}

export const heldAccessView: View = {
  path: '/acessos/vigentes',
  title: 'Acessos vigentes',
  render: async () => {
    const held = await governanceRead.held()
    return html`
      ${await tabs('/acessos/vigentes')}
      <p class="muted access-intro">Quem tem o quê agora, nos sistemas que você acompanha.</p>
      ${list(
        held.items.map((each) => entitlementRow(each, { showMember: true, canRemove: true })),
        'Nenhum acesso vigente.'
      )}
    `
  },
  bind: bindRows
}

export const accessSystemsView: View = {
  path: '/acessos/sistemas',
  title: 'Sistemas',
  render: async () => html`${await tabs('/acessos/sistemas')}${await systemsSection()}`,
  bind: (root) => {
    bindRows(root)
    bindSystems(root)
  }
}
