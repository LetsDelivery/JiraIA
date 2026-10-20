import { accessRead, type Group } from '@/api/access'
import { type Proposal, proposalsRead } from '@/api/proposals'
import { type Card, type CardChanges, type CardRef, type Comment, type HistoryEvent, read, write } from '@/api/requests'
import { ESTIMATES, PRIORITIES, PRIORITY_LABEL, parseLabels } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { spacePath } from '@/lib/space-types'
import type { BoardContext } from '@/views/board'

import { type ActivityTab, activitySection, bindActivity } from './card-activity'
import { attachmentsSection, bindAttachments, uploadFile } from './card-attachments'
import { bindComments, commentsSection } from './card-comments'
import { bindRelations, type ComposeForm, type RelationsContext, relationsSection } from './card-relations'
import { bindCustomFields, customFieldInputs } from './custom-fields'
import { bindDatePickers, dateField } from './date-picker'
import { detailPanel } from './detail-panel'
import { openFormDialog } from './dialog'
import { icon } from './icons'
import { proposalStrip } from './proposal-strip'
import { bindSelects, selectField } from './select'
import { bindSquadField, type SquadContext, squadField } from './squad-field'
import { toast } from './toast'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

const fields = (card: Card, context: BoardContext): Html => {
  const canWrite = context.canWrite
  const people = [
    { value: '', label: 'Sem responsável' },
    ...context.members
      .filter((member) => member.status === 'active' && member.kind === 'person')
      .map((member) => ({ value: member.id, label: member.name }))
  ]
  const select = (name: string, label: string, options: { value: string; label: string }[], value: string) =>
    canWrite
      ? selectField({ name, label, options, value, attributes: html`data-field="${name}"` })
      : html`<div class="field"><span class="label">${label}</span><span>${options.find((option) => option.value === value)?.label ?? '—'}</span></div>`

  return html`
    ${select(
      'typeId',
      'Tipo',
      context.workflow.types.map((type) => ({ value: type.id, label: type.name })),
      card.typeId
    )}
    ${select('assigneeId', 'Responsável', people, card.assignee?.id ?? '')}
    ${canWrite && card.assignee?.id !== context.meId ? html`<button type="button" class="detail-assign" data-assign-me>Atribuir a mim</button>` : ''}
    <div class="field"><span class="label">Relator</span><span>${card.reporter.name}</span></div>
    ${select(
      'priority',
      'Prioridade',
      PRIORITIES.map((priority) => ({ value: priority, label: PRIORITY_LABEL[priority] })),
      card.priority
    )}
    ${select('estimate', 'Estimativa', [{ value: '', label: 'Sem estimativa' }, ...ESTIMATES.map((size) => ({ value: size, label: size }))], card.estimate ?? '')}
    <div class="field">
      <label for="card-labels">Labels</label>
      <input id="card-labels" class="input" data-labels value="${card.labels.join(', ')}" ${canWrite ? '' : html`readonly`} placeholder="okr-saude-escala, business-form" />
    </div>
    ${dateField({ name: 'dueDate', label: 'Data limite', value: card.dueDate, readonly: !canWrite, attributes: html`data-due` })}
    <div class="detail-props-custom" data-custom-fields>${customFieldInputs(card, context.fields, context.members, canWrite)}</div>
  `
}

/**
 * What a person does to the card, above its fields: the state as a button — the most frequent change —
 * and moving the card to another space.
 */
const toolbar = (card: Card, context: BoardContext): Html => {
  const state = context.workflow.states.find((each) => each.id === card.stateId)
  if (!context.canWrite) {
    return html`<div class="detail-toolbar"><span class="status-pill status-${state?.group ?? 'not_started'}">${state?.name ?? '—'}</span></div>`
  }
  const options = context.workflow.states.map((each) => ({ value: each.id, label: each.name }))
  return html`
    <div class="detail-toolbar">
      <div class="status-select status-${state?.group ?? 'not_started'}">
        ${selectField({ name: 'stateId', label: 'Estado', visibleLabel: false, options, value: card.stateId, attributes: html`data-field="stateId"` })}
      </div>
      <button type="button" class="button button-secondary button-icon" data-transfer aria-label="Mover para outro espaço" title="Mover para outro espaço">${icon('arrowsRightLeft', 16)}</button>
    </div>
  `
}

/** The side column: the actions, the fields in one panel, and when the card was born. */
const side = (card: Card, context: BoardContext): Html => html`
  <aside class="detail-side">
    ${toolbar(card, context)}
    ${detailPanel({ title: 'Detalhes', body: html`<div class="detail-props">${fields(card, context)}</div>` })}
    <p class="detail-meta">Criado em ${WHEN.format(new Date(card.createdAt))}<br />Atualizado em ${WHEN.format(new Date(card.updatedAt))}</p>
  </aside>
`

type Loaded = {
  /** Agents' proposals about this card still waiting for someone (ADR-0019). */
  proposals: readonly Proposal[]
  comments: Comment[]
  history: HistoryEvent[]
  relations: Awaited<ReturnType<typeof read.relations>>
  attachments: Awaited<ReturnType<typeof read.attachments>>['items']
  watchers: Awaited<ReturnType<typeof read.watchers>>['items']
  groups: readonly Group[]
  isOrgAdmin: boolean
}

const watchButton = (loaded: Loaded, meId: string): Html => {
  const watching = loaded.watchers.some((watcher) => watcher.id === meId)
  const who = loaded.watchers.map((watcher) => watcher.name).join(', ') || 'ninguém'
  return html`<button type="button" class="button button-ghost" data-watch aria-pressed="${watching}" title="Observam: ${who}">
    ${icon(watching ? 'eye' : 'eyeOff', 16)}${watching ? 'Observando' : 'Observar'} <span class="count">${loaded.watchers.length}</span></button>`
}

const header = (card: Card, context: BoardContext, loaded: Loaded): Html => html`
  <header class="detail-header">
    <p class="detail-crumb">
      <span>${context.spaceKey}</span><span aria-hidden="true">/</span>
      <span>${context.workflow.types.find((type) => type.id === card.typeId)?.name ?? 'Card'}</span><span aria-hidden="true">/</span>
      <span class="key">${card.key}</span>
    </p>
    <div class="detail-actions">
      ${watchButton(loaded, context.meId)}
      <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button>
    </div>
  </header>
`

const description = (card: Card, canWrite: boolean): Html =>
  detailPanel({
    title: html`<label for="card-description">Descrição</label>`,
    attributes: html`data-description-block`,
    body: html`
      <textarea id="card-description" class="detail-description" data-description rows="4" ${canWrite ? '' : html`readonly`}
        placeholder="${canWrite ? 'Adicione contexto, problema, escopo, critérios de aceite…' : 'Sem descrição.'}">${card.description}</textarea>
      ${canWrite ? html`<div class="description-actions"><button type="button" class="button button-primary button-small" data-save-description>Salvar descrição</button></div>` : ''}`
  })

const content = (card: Card, context: BoardContext, loaded: Loaded, sections: Html): Html => html`
  <div class="detail-root" data-detail-root>
  ${header(card, context, loaded)}
  <div class="detail-grid">
    <div class="detail-main">
      ${proposalStrip(loaded.proposals)}
      <label class="sr-only" for="card-title">Título</label>
      <textarea id="card-title" class="detail-title" data-title rows="1" ${context.canWrite ? '' : html`readonly`} maxlength="255">${card.title}</textarea>
      ${description(card, context.canWrite)}
      ${sections}
    </div>
    ${side(card, context)}
  </div>
  </div>
`

/**
 * A card, opened over the board in a glass dialog (ADR-0006). Each field saves on its own and the
 * history below updates with it; the board behind re-renders from the same write.
 */
export const openCardDetail = (card: Card, context: BoardContext): void => {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog glass card-detail'
  dialog.setAttribute('aria-label', `${card.key} ${card.title}`)
  document.body.append(dialog)

  const url = new URL(location.href)
  url.searchParams.set('card', card.key)
  history.replaceState(null, '', url)

  const close = () => {
    dialog.close()
    dialog.remove()
    const back = new URL(location.href)
    back.searchParams.delete('card')
    history.replaceState(null, '', back)
  }
  dialog.addEventListener('cancel', close)
  dialog.showModal()
  void render(dialog, card, context, close)
}

const load = async (cardId: string): Promise<Loaded> => {
  const [proposals, comments, events, relations, attachments, watchers, groups, me] = await Promise.all([
    proposalsRead.forCard(cardId).catch(() => ({ items: [] })),
    read.comments(cardId),
    read.history(cardId),
    read.relations(cardId),
    read.attachments(cardId),
    read.watchers(cardId),
    accessRead.groups(),
    read.me()
  ])
  return {
    proposals: proposals.items,
    comments: comments.items,
    history: events.items,
    relations,
    attachments: attachments.items,
    watchers: watchers.items,
    groups: groups.items,
    isOrgAdmin: me.isOrgAdmin
  }
}

const render = async (
  dialog: HTMLDialogElement,
  card: Card,
  context: BoardContext,
  close: () => void
): Promise<void> => {
  const loaded = await load(card.id)
  const again = (next = card) => void render(dialog, next, context, close)
  const attachContext = {
    cardId: card.id,
    meId: context.meId,
    canWrite: context.canWrite,
    manages: context.manages,
    refresh: () => again()
  }
  const commentContext = {
    cardId: card.id,
    meId: context.meId,
    members: context.members,
    refresh: () => again(),
    attach: (file: File) => uploadFile(attachContext, file)
  }
  const relationContext = relationsOf(dialog, card, context, close)
  const squadContext = squadOf(card, context, loaded, again)
  const tab = (dialog.dataset.activity ?? 'comments') as ActivityTab
  const comments = { html: commentsSection(loaded.comments, commentContext), count: loaded.comments.length }
  const sections = html`
    ${detailPanel({ title: 'Squad', body: squadField(squadContext) })}
    ${relationsSection(loaded.relations, relationContext)}
    ${attachmentsSection(loaded.attachments, attachContext)}
    ${activitySection({ ...context, groups: loaded.groups }, loaded.history, comments, tab)}
  `

  keepScroll(dialog, () => {
    dialog.innerHTML = content(card, context, loaded, sections).value
  })
  bindSelects(dialog)
  bindDatePickers(dialog)
  bindDetail(dialog, card, context, close)
  bindRelations(dialog, loaded.relations, relationContext)
  bindSquadField(dialog.querySelector('[data-detail-root]') as HTMLElement, squadContext)
  bindAttachments(dialog, attachContext)
  bindComments(dialog, loaded.comments, commentContext)
  bindWatch(dialog, card, () => again())
  dialog.querySelector('[data-proposal-strip] a')?.addEventListener('click', close)
  bindActivity(dialog, (chosen) => {
    dialog.dataset.activity = chosen
  })
}

/** What the relations panels need; which composer is open lives on the dialog, across redraws. */
const relationsOf = (
  dialog: HTMLDialogElement,
  card: Card,
  context: BoardContext,
  close: () => void
): RelationsContext => {
  const composing = new Set((dialog.dataset.composing ?? '').split(',').filter(Boolean) as ComposeForm[])
  return {
    card,
    canWrite: context.canWrite,
    types: context.workflow.types,
    subtaskTypeId: context.workflow.types.find((type) => type.name === 'Subtarefa')?.id,
    composing,
    remember: (form, open) => {
      open ? composing.add(form) : composing.delete(form)
      dialog.dataset.composing = [...composing].join(',')
    },
    refresh: () => void read.cardByKey(card.key).then((next) => render(dialog, next, context, close)),
    open: (ref: CardRef) => openRef(ref, context, close)
  }
}

const squadOf = (card: Card, context: BoardContext, loaded: Loaded, again: (next?: Card) => void): SquadContext => ({
  current: card.group,
  groups: loaded.groups,
  canWrite: context.canWrite,
  canCreate: loaded.isOrgAdmin,
  choose: (groupId) =>
    void write
      .updateCard(card, { groupId })
      .then(again)
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error')),
  refresh: () => void read.cardByKey(card.key).then(again)
})

/** Each column scrolls on its own; a redraw after a save must leave the reader where they were. */
const keepScroll = (dialog: HTMLDialogElement, redraw: () => void): void => {
  const columns = ['.detail-main', '.detail-side']
  const before = columns.map((selector) => dialog.querySelector(selector)?.scrollTop ?? 0)
  redraw()
  columns.forEach((selector, index) => {
    const column = dialog.querySelector(selector)
    if (column) {
      column.scrollTop = before[index] ?? 0
    }
  })
}

/** A card of this board opens here; one of another space opens on its own board. */
const openRef = (ref: CardRef, context: BoardContext, close: () => void): void => {
  const here = context.cards.find((card) => card.id === ref.id)
  close()
  if (here) {
    openCardDetail(here, context)
  } else {
    navigate(`${spacePath(ref.key.split('-')[0] ?? '')}?card=${ref.key}`)
  }
}

const bindWatch = (dialog: HTMLDialogElement, card: Card, again: () => void): void => {
  const button = dialog.querySelector<HTMLButtonElement>('[data-watch]')
  button?.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true'
    write
      .watch(card.id, on)
      .then(() => again())
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  })
}

const bindDetail = (dialog: HTMLDialogElement, card: Card, context: BoardContext, close: () => void): void => {
  const save = (changes: CardChanges) =>
    write
      .updateCard(card, changes)
      .then((updated) => render(dialog, updated, context, close))
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  const value = (selector: string) =>
    dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value ?? ''

  // On the content, which every render replaces — never on the dialog, where listeners would pile up.
  const root = dialog.querySelector('[data-detail-root]') as HTMLElement
  dialog.querySelector('[data-close]')?.addEventListener('click', close)
  bindCustomFields(
    root.querySelector('[data-custom-fields]') as HTMLElement,
    (values) => void save({ customFields: values })
  )
  root.addEventListener('select-change', (event) => {
    const field = (event.target as HTMLElement).dataset.field
    if (!field) {
      return
    }
    const chosen = (event as CustomEvent<{ value: string }>).detail.value
    const nullable = field === 'assigneeId' || field === 'estimate' || field === 'groupId'
    void save({ [field]: nullable && !chosen ? null : chosen } as CardChanges)
  })
  root.querySelector('[data-due]')?.addEventListener('date-change', (event) => {
    void save({ dueDate: (event as CustomEvent<{ value: string | null }>).detail.value })
  })
  bindEditing(dialog)
  dialog.querySelector('[data-title]')?.addEventListener('change', () => {
    if (value('[data-title]').trim() && value('[data-title]') !== card.title) {
      void save({ title: value('[data-title]').trim() })
    }
  })
  dialog
    .querySelector('[data-labels]')
    ?.addEventListener('change', () => void save({ labels: parseLabels(value('[data-labels]')) }))
  dialog
    .querySelector('[data-save-description]')
    ?.addEventListener('click', () =>
      save({ description: value('[data-description]') }).then(() => toast('Descrição salva.'))
    )
  dialog.querySelector('[data-transfer]')?.addEventListener('click', () => void transfer(card, context, close))
  dialog.querySelector('[data-assign-me]')?.addEventListener('click', () => void save({ assigneeId: context.meId }))
}

/** The title wraps like text but Enter commits it, as in an input; the description offers Save once edited. */
const bindEditing = (dialog: HTMLDialogElement): void => {
  const title = dialog.querySelector<HTMLTextAreaElement>('[data-title]')
  title?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      title.blur()
    }
  })
  const block = dialog.querySelector<HTMLElement>('[data-description-block]')
  block?.addEventListener('input', () => block.classList.add('is-dirty'))
}

/** Moves the card to a space the caller can write in (escopo-mvp 2.14); its old key keeps opening it. */
const transfer = async (card: Card, context: BoardContext, close: () => void): Promise<void> => {
  const spaces = (await read.spaces()).items.filter((space) => space.id !== context.spaceId)
  openFormDialog({
    title: `Mover ${card.key} para outro espaço`,
    submit: 'Mover',
    done: 'Card movido.',
    fields: html`
      <p class="muted">O card ganha uma chave nova no destino; ${card.key} continua abrindo ele. Os campos customizados ficam só no histórico.</p>
      ${selectField({ name: 'spaceId', label: 'Espaço de destino', options: spaces.map((space) => ({ value: space.id, label: `${space.key} · ${space.name}` })) })}
    `,
    onSubmit: async (data) => {
      const moved = await write.transferCard(card, String(data.get('spaceId')))
      close()
      toast(`${card.key} agora é ${moved.key}.`)
    }
  })
}
