import type { HistoryEvent } from '@/api/requests'
import { initials, PRIORITY_LABEL } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { LINK_LABEL, type LinkType } from '@/lib/relations'
import type { BoardContext } from '@/views/board'

import { detailPanel } from './detail-panel'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

const FIELD_LABEL: Record<string, string> = {
  title: 'Título',
  description: 'Descrição',
  stateId: 'Estado',
  typeId: 'Tipo',
  assigneeId: 'Responsável',
  groupId: 'Squad',
  priority: 'Prioridade',
  labels: 'Labels',
  dueDate: 'Data limite',
  estimate: 'Estimativa',
  points: 'Pontos',
  sprintId: 'Sprint',
  parentId: 'Card pai',
  key: 'Chave',
  spaceId: 'Espaço',
  link: 'Vínculo',
  attachment: 'Anexo',
  body: 'Texto'
}

const ACTION_LABEL: Record<string, string> = {
  created: 'criou o card',
  updated: 'alterou',
  moved: 'moveu',
  commented: 'comentou',
  comment_edited: 'editou um comentário',
  linked: 'vinculou',
  unlinked: 'desvinculou',
  attached: 'anexou',
  detached: 'removeu um anexo',
  transferred: 'moveu para outro espaço'
}

/** Lines of history drawn without their changes: the action says it all. */
const QUIET = new Set(['created', 'commented', 'comment_edited'])

const TABS = [
  { id: 'all', label: 'Tudo' },
  { id: 'comments', label: 'Comentários' }
] as const

export type ActivityTab = (typeof TABS)[number]['id']

/** What the history needs to name an id: the board, and the organization's groups. */
export type HistoryContext = BoardContext & { groups: readonly { id: string; name: string }[] }

const _link = (value: unknown): string => {
  const link = value as { type: LinkType; from: string; to: string }
  return `${link.from} ${LINK_LABEL[link.type]?.outward ?? link.type} ${link.to}`
}

/** An id in the history, as the name a person recognises. */
const nameOf = (context: HistoryContext, field: string, value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '—'
  }
  const lookups: Record<string, () => string | undefined> = {
    stateId: () => context.workflow.states.find((state) => state.id === value)?.name,
    typeId: () => context.workflow.types.find((type) => type.id === value)?.name,
    assigneeId: () => context.members.find((member) => member.id === value)?.name,
    groupId: () => context.groups.find((group) => group.id === value)?.name ?? 'grupo removido',
    priority: () => PRIORITY_LABEL[value as keyof typeof PRIORITY_LABEL],
    labels: () => (Array.isArray(value) ? value.join(', ') || '—' : undefined),
    description: () => 'texto alterado',
    parentId: () => context.cards.find((card) => card.id === value)?.key ?? 'outro card',
    sprintId: () => context.sprints.find((sprint) => sprint.id === value)?.name ?? 'sprint removida',
    spaceId: () => (value === context.spaceId ? context.spaceKey : 'outro espaço'),
    link: () => _link(value)
  }
  return lookups[field]?.() ?? (Array.isArray(value) ? value.join(', ') : String(value))
}

const fieldLabel = (context: HistoryContext, field: string): string =>
  field.startsWith('field:')
    ? (context.fields.find((each) => each.id === field.slice(6))?.name ?? 'Campo removido')
    : (FIELD_LABEL[field] ?? field)

const historyLine = (context: HistoryContext, event: HistoryEvent): Html => {
  const actor = context.members.find((member) => member.id === event.actorId)?.name ?? 'Alguém'
  const changes = QUIET.has(event.action) ? [] : Object.entries(event.changes)

  return html`
    <li>
      <span class="avatar">${initials(actor)}</span>
      <div class="history-text">
        <p><strong>${actor}</strong> ${ACTION_LABEL[event.action] ?? event.action}${event.via ? html` <span class="history-via">via ${event.via}</span>` : ''} <span class="muted">· ${WHEN.format(new Date(event.occurredAt))}</span></p>
        ${changes.map(
          ([field, change]) =>
            html`<p class="muted">${fieldLabel(context, field)}: ${nameOf(context, field, change.before)} → ${nameOf(context, field, change.after)}</p>`
        )}
      </div>
    </li>
  `
}

/**
 * The card's activity in one panel, as tabs (escopo-mvp 2.8, 2.10): "Tudo" is every action on the
 * card, newest first; "Comentários" is the conversation. The chosen tab lives on the dialog, so it
 * survives the redraw that follows every save.
 */
export const activitySection = (
  context: HistoryContext,
  history: readonly HistoryEvent[],
  comments: { html: Html; count: number },
  tab: ActivityTab
): Html =>
  detailPanel({
    title: 'Atividade',
    attributes: html`data-activity="${tab}"`,
    actions: html`<div class="activity-tabs" role="tablist" aria-label="Atividade">
      ${TABS.map(
        (each) =>
          html`<button type="button" class="activity-tab" role="tab" data-activity-tab="${each.id}" aria-selected="${each.id === tab}">${each.label}${each.id === 'comments' && comments.count ? html` <span class="count">${comments.count}</span>` : ''}</button>`
      )}
    </div>`,
    body: html`
      <div class="activity-comments">${comments.html}</div>
      <ul class="history activity-history" aria-label="Histórico">${[...history].reverse().map((event) => historyLine(context, event))}</ul>`
  })

export const bindActivity = (root: HTMLElement, choose: (tab: ActivityTab) => void): void => {
  const section = root.querySelector<HTMLElement>('[data-activity]')
  section?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-activity-tab]')
    if (!button) {
      return
    }
    section.dataset.activity = button.dataset.activityTab
    for (const each of section.querySelectorAll('[data-activity-tab]')) {
      each.setAttribute('aria-selected', String(each === button))
    }
    choose(button.dataset.activityTab as ActivityTab)
  })
}
