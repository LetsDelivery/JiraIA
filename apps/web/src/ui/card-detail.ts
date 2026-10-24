import { accessRead, type Group } from '@/api/access'
import { type Proposal, proposalsRead } from '@/api/proposals'
import {
  type Card,
  type CardChanges,
  type CardRef,
  type CardType,
  type Comment,
  type HistoryEvent,
  read,
  write
} from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { spacePath } from '@/lib/space-types'
import type { BoardContext } from '@/views/board'

import { type ActivityTab, activitySection, bindActivity } from './card-activity'
import { attachButton, attachmentsSection, bindAttachments, uploadFile } from './card-attachments'
import { bindComments, commentsSection } from './card-comments'
import { type DescriptionHandle, descriptionSection, mountDescription } from './card-description'
import { pickLabels } from './card-pickers'
import { bindRelations, type ComposeForm, type RelationsContext, relationsSection } from './card-relations'
import { bindSide, type SideGroup, side } from './card-side'
import { bindCustomFields } from './custom-fields'
import { bindDatePickers } from './date-picker'
import { openFormDialog } from './dialog'
import { applyArrival } from './email-arrival'
import { icon } from './icons'
import { proposalStrip } from './proposal-strip'
import { bindSelects, selectField } from './select'
import { bindSquadField, type SquadContext, squadField } from './squad-field'
import { toast } from './toast'
import { typeIcon } from './type-look'

/** Each open card's description editor, destroyed before a redraw replaces it and when the card closes. */
const descriptions = new WeakMap<HTMLDialogElement, DescriptionHandle>()

type Loaded = {
  /** Agents' proposals about this card still waiting for someone (ADR-0019). */
  proposals: readonly Proposal[]
  comments: Comment[]
  history: HistoryEvent[]
  relations: Awaited<ReturnType<typeof read.relations>>
  attachments: Awaited<ReturnType<typeof read.attachments>>['items']
  watchers: Awaited<ReturnType<typeof read.watchers>>['items']
  starred: boolean
  groups: readonly Group[]
  isOrgAdmin: boolean
}

const watchButton = (loaded: Loaded, meId: string): Html => {
  const watching = loaded.watchers.some((watcher) => watcher.id === meId)
  const who = loaded.watchers.map((watcher) => watcher.name).join(', ') || 'ninguém'
  return html`<button type="button" class="button button-ghost" data-watch aria-pressed="${watching}" title="Observam: ${who}">
    ${icon(watching ? 'eye' : 'eyeOff', 16)}${watching ? 'Observando' : 'Observar'} <span class="count">${loaded.watchers.length}</span></button>`
}

const starButton = (starred: boolean): Html =>
  html`<button type="button" class="button button-ghost button-icon" data-star aria-pressed="${starred}"
    aria-label="${starred ? 'Desmarcar estrela' : 'Marcar com estrela'}" title="${starred ? 'Desmarcar estrela' : 'Marcar com estrela'}">
    ${icon(starred ? 'starFilled' : 'star', 16)}</button>`

/** The card's type in the path: its icon in its colour, then its name. */
const crumbType = (type: CardType | undefined): Html =>
  type ? html`<span class="detail-crumb-type">${typeIcon(type, 16)}${type.name}</span>` : html`<span>Card</span>`

const header = (card: Card, context: BoardContext, loaded: Loaded): Html => html`
  <header class="detail-header">
    <p class="detail-crumb">
      <span>${context.spaceKey}</span><span aria-hidden="true">/</span>
      ${crumbType(context.workflow.types.find((type) => type.id === card.typeId))}<span aria-hidden="true">/</span>
      <span class="key">${card.key}</span>
    </p>
    <div class="detail-actions">
      ${starButton(loaded.starred)}
      ${watchButton(loaded, context.meId)}
      <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button>
    </div>
  </header>
`

/**
 * What a person adds to the card, under its text: a subtask, a link, a file. Each opens its section,
 * which stays out of sight while the card has none (Jira's row under the title).
 */
const actionBar = (canWrite: boolean): Html =>
  canWrite
    ? html`<div class="detail-add" role="group" aria-label="Adicionar ao card">
        <button type="button" class="button button-secondary button-small" data-compose-start="subtask" aria-label="Adicionar subtarefa">${icon('subtask', 16)}Subtarefa</button>
        <button type="button" class="button button-secondary button-small" data-compose-start="link" aria-label="Vincular card">${icon('link', 16)}Vincular</button>
        ${attachButton()}
      </div>`
    : html``

type Parts = { sections: Html; squad: Html; folded: ReadonlySet<SideGroup> }

const content = (card: Card, context: BoardContext, loaded: Loaded, parts: Parts): Html => html`
  <div class="detail-root" data-detail-root>
  ${header(card, context, loaded)}
  <div class="detail-grid">
    <div class="detail-main" data-drop-files>
      ${proposalStrip(loaded.proposals)}
      <label class="sr-only" for="card-title">Título</label>
      <textarea id="card-title" class="detail-title" data-title rows="1" ${context.canWrite ? '' : html`readonly`} maxlength="255">${card.title}</textarea>
      ${descriptionSection(context.canWrite, !card.description.trim())}
      ${actionBar(context.canWrite)}
      ${parts.sections}
    </div>
    ${side(card, context, parts.squad, parts.folded)}
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
    descriptions.get(dialog)?.destroy()
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
  const [proposals, comments, events, relations, attachments, watchers, star, groups, me] = await Promise.all([
    proposalsRead.forCard(cardId).catch(() => ({ items: [] })),
    read.comments(cardId),
    read.history(cardId),
    read.relations(cardId),
    read.attachments(cardId),
    read.watchers(cardId),
    read.cardStar(cardId),
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
    starred: star.starred,
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
  const folded = new Set((dialog.dataset.folded ?? '').split(',').filter(Boolean) as SideGroup[])
  const comments = { html: commentsSection(loaded.comments, commentContext), count: loaded.comments.length }
  const sections = html`
    ${relationsSection(loaded.relations, relationContext)}
    ${attachmentsSection(loaded.attachments, attachContext)}
    ${activitySection({ ...context, groups: loaded.groups }, loaded.history, comments, tab)}
  `

  const previous = descriptions.get(dialog)
  const draft = previous?.draft()
  previous?.destroy()
  keepScroll(dialog, () => {
    dialog.innerHTML = content(card, context, loaded, { sections, squad: squadField(squadContext), folded }).value
  })
  bindSelects(dialog)
  bindDatePickers(dialog)
  bindDetail(dialog, card, context, close)
  descriptions.set(
    dialog,
    mountDescription(dialog, {
      markdown: card.description,
      draft,
      canWrite: context.canWrite,
      save: (markdown) =>
        write
          .updateCard(card, { description: markdown })
          .then((updated) => {
            toast('Descrição salva.')
            void render(dialog, updated, context, close)
            return true
          })
          .catch((refusal: unknown) => {
            toast(refusalSentence(refusal), 'error')
            return false
          })
    })
  )
  bindRelations(dialog, loaded.relations, relationContext)
  bindSquadField(dialog.querySelector('[data-detail-root]') as HTMLElement, squadContext)
  bindAttachments(dialog, attachContext)
  bindComments(dialog, loaded.comments, commentContext)
  bindWatch(dialog, card, () => again())
  bindStar(dialog, card, () => again())
  bindSide(dialog.querySelector('[data-detail-root]') as HTMLElement, (group, closed) => {
    closed ? folded.add(group) : folded.delete(group)
    dialog.dataset.folded = [...folded].join(',')
  })
  dialog.querySelector('[data-proposal-strip] a')?.addEventListener('click', close)
  bindActivity(dialog, (chosen) => {
    dialog.dataset.activity = chosen
  })
  applyArrival(dialog)
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

const bindStar = (dialog: HTMLDialogElement, card: Card, again: () => void): void => {
  const button = dialog.querySelector<HTMLButtonElement>('[data-star]')
  button?.addEventListener('click', () => {
    write
      .starCard(card.id, button.getAttribute('aria-pressed') !== 'true')
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
    void save(_change(field, chosen))
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
  const labels = dialog.querySelector<HTMLElement>('[data-labels-pick]')
  labels?.addEventListener('click', () => pickLabels(labels, card, context, (changes) => void save(changes)))
  dialog.querySelector('[data-transfer]')?.addEventListener('click', () => void transfer(card, context, close))
  dialog.querySelector('[data-assign-me]')?.addEventListener('click', () => void save({ assigneeId: context.meId }))
}

/** The fields a person can empty, which the API takes as `null`. */
const NULLABLE = new Set(['assigneeId', 'estimate', 'groupId', 'sprintId', 'points'])

/** A select's choice as the change the API takes: points are a number, an emptied field is `null`. */
const _change = (field: string, chosen: string): CardChanges => {
  if (NULLABLE.has(field) && !chosen) {
    return { [field]: null } as CardChanges
  }
  return { [field]: field === 'points' ? Number(chosen) : chosen } as CardChanges
}

/** The title wraps like text but Enter commits it, as in an input. */
const bindEditing = (dialog: HTMLDialogElement): void => {
  const title = dialog.querySelector<HTMLTextAreaElement>('[data-title]')
  title?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      title.blur()
    }
  })
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
