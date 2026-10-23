import {
  type Card,
  type CardRef,
  type Field,
  type Member,
  read,
  type State,
  type Workflow,
  write
} from '@/api/requests'
import { invalidate } from '@/lib/cache'
import { dropIndex, initials, PRIORITY_ICON, PRIORITY_LABEL } from '@/lib/cards'
import { assignableIds, type CardFilter, isEmpty } from '@/lib/filters'
import { type Html, html } from '@/lib/html'
import { LANE_BY, LANE_FIELD, LANE_LABEL, type Lane, type LaneBy, lanesOf } from '@/lib/lanes'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { cardsMatching } from '@/lib/search'
import { spacePath } from '@/lib/space-types'
import { persistedStore } from '@/lib/store'
import { openCardDetail } from '@/ui/card-detail'
import { bindCardPicker } from '@/ui/card-picker'
import { openFormDialog, textField } from '@/ui/dialog'
import { openFieldsEditor } from '@/ui/fields-dialog'
import { icon } from '@/ui/icons'
import { selectField } from '@/ui/select'
import { toast } from '@/ui/toast'
import { openWorkflowEditor } from '@/ui/workflow-dialog'

export type BoardContext = {
  spaceId: string
  spaceKey: string
  workflow: Workflow
  cards: readonly Card[]
  fields: readonly Field[]
  members: readonly Member[]
  /** Who the Responsável filter offers: the space's people, not the whole organization (`assignableIds`). */
  assignable: ReadonlySet<string>
  meId: string
  canWrite: boolean
  manages: boolean
  /** A filter narrows `cards` (3.4); orders that need every card, as the backlog's, wait until it is cleared. */
  filtered: boolean
}

/** Swimlanes are a viewer's preference, per space, on this browser. */
const lanePreference = persistedStore<Record<string, LaneBy>>('jiraia.board.lanes', {})
export const laneOf = (spaceId: string): LaneBy => lanePreference.get()[spaceId] ?? 'none'

/** A saved view opens with its own lanes (3.5). */
export const setLanes = (spaceId: string, lanes: LaneBy): void => {
  lanePreference.set({ ...lanePreference.get(), [spaceId]: lanes })
}

export const tile = (card: Card, canWrite: boolean): Html => html`
  <li class="card-tile" data-card-id="${card.id}" ${canWrite ? html`draggable="true"` : ''}
    data-search="${`${card.key} ${card.title}`.toLowerCase()}" data-assignee="${card.assignee?.id ?? ''}">
    <button type="button" class="card-open" data-open-card="${card.id}">
      <span class="card-tile-title">${card.title}</span>
      ${card.labels.length > 0 ? html`<span class="chips">${card.labels.slice(0, 2).map((label) => html`<span class="chip">${label}</span>`)}</span>` : ''}
      <span class="card-tile-meta">
        <span class="card-key">${card.key}</span>
        ${card.parentId ? html`<span class="muted" title="Subtarefa">${icon('subtask', 14)}</span>` : ''}
        <span class="priority priority-${card.priority}" title="Prioridade ${PRIORITY_LABEL[card.priority]}">${icon(PRIORITY_ICON[card.priority], 16)}</span>
        ${card.assignee ? html`<span class="avatar" title="${card.assignee.name}">${initials(card.assignee.name)}</span>` : ''}
      </span>
    </button>
  </li>
`

const cardsList = (state: State, cards: readonly Card[], canWrite: boolean, lane: string): Html => html`
  <ol class="column-cards" data-drop-state="${state.id}" data-lane="${lane}" aria-label="${state.name}">${cards.map((card) => tile(card, canWrite))}</ol>
`

const columnHead = (state: State, total: number): Html => html`
  <header class="column-head">
    <span class="group-dot group-${state.group}" aria-hidden="true"></span>
    <h3>${state.name}</h3>
    <span class="count">${total}</span>
  </header>
`

const quickAdd = (state: State): Html => html`
  <form class="quick-add" data-quick-add="${state.id}">
    <input class="input quick-add-input" name="title" placeholder="+ Criar card" aria-label="Novo card em ${state.name}" maxlength="255" />
  </form>
`

const column = (state: State, cards: readonly Card[], canWrite: boolean): Html => html`
  <section class="column" aria-label="${state.name}">
    ${columnHead(state, cards.length)}
    ${cardsList(state, cards, canWrite, '')}
    ${canWrite ? quickAdd(state) : ''}
  </section>
`

const inState = (cards: readonly Card[], state: State) => cards.filter((card) => card.stateId === state.id)

/** The board in lanes: column heads once on top, then one row of columns per lane (escopo-mvp 3.1). */
const laned = (context: BoardContext, lanes: Lane<Card>[]): Html => html`
  <div class="board board-laned" style="--columns: ${context.workflow.states.length}">
    ${context.workflow.states.map((state) => html`<div class="column column-top">${columnHead(state, inState(context.cards, state).length)}</div>`)}
    ${lanes.map(
      (lane) => html`
        <h4 class="lane-title">${lane.label} <span class="count">${lane.cards.length}</span></h4>
        ${context.workflow.states.map((state) => html`<div class="column column-lane">${cardsList(state, inState(lane.cards, state), context.canWrite, lane.value)}</div>`)}
      `
    )}
  </div>
`

const LANE_OPTIONS = LANE_BY.map((by) => ({ value: by, label: LANE_LABEL[by] }))

/** The kanban: one column per state, in the workflow's order, optionally in lanes (escopo-mvp 3.1). */
export const board = (context: BoardContext): Html => {
  const by = laneOf(context.spaceId)
  const names = { types: context.workflow.types, cards: context.cards }
  return html`
    <div class="toolbar">
      <div class="search card-picker" data-board-search-box>
        <label class="sr-only" for="board-search">Pesquisar cards</label>
        <input id="board-search" type="search" class="input" data-board-search placeholder="Pesquisar por título ou chave"
          autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="board-search-list" aria-expanded="false" />
        <ul class="select-menu glass card-picker-menu" role="listbox" id="board-search-list" hidden></ul>
      </div>
      <button type="button" class="button button-secondary" data-only-mine aria-pressed="false">${icon('user', 16)}Só os meus</button>
      ${selectField({ name: 'lanes', label: 'Raias', visibleLabel: false, options: LANE_OPTIONS, value: by, attributes: html`data-lanes` })}
      ${context.manages ? html`<button type="button" class="button button-secondary" data-configure>${icon('adjustments', 16)}Configurar fluxo</button>` : ''}
      ${context.manages ? html`<button type="button" class="button button-secondary" data-fields>${icon('forms', 16)}Campos</button>` : ''}
      ${context.canWrite ? html`<button type="button" class="button button-primary" data-create-card>${icon('plus')}Criar card</button>` : ''}
    </div>
    ${
      by === 'none'
        ? html`<div class="board">${context.workflow.states.map((state) => column(state, inState(context.cards, state), context.canWrite))}</div>`
        : laned(context, lanesOf(context.cards, by, names))
    }
  `
}

/** The quick-add input to focus again after the board re-renders, so cards can be typed one after another. */
let refocus: string | undefined

export const bindBoard = (root: HTMLElement, context: BoardContext): void => {
  bindFilters(root, context.meId)
  bindBoardSearch(root, context)
  bindDragAndDrop(root, context)
  bindQuickAdd(root, context.spaceId)
  bindOpenCards(root, context)
  root.querySelector('[data-configure]')?.addEventListener('click', () => void openWorkflowEditor(context.spaceId))
  root.querySelector('[data-fields]')?.addEventListener('click', () => void openFieldsEditor(context.spaceId))
  root.querySelector('[data-create-card]')?.addEventListener('click', () => createCard(context))
  root.querySelector('[data-lanes]')?.addEventListener('select-change', (event) => {
    lanePreference.set({
      ...lanePreference.get(),
      [context.spaceId]: (event as CustomEvent<{ value: LaneBy }>).detail.value
    })
    invalidate(`space:${context.spaceId}:cards`)
  })
}

/** Every `[data-open-card]` under `root` opens that card; `?card=KEY-n` in the address opens it too. */
export const bindOpenCards = (root: HTMLElement, context: BoardContext): void => {
  root.querySelectorAll<HTMLElement>('[data-open-card]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = context.cards.find((each) => each.id === button.dataset.openCard)
      if (card) {
        openCardDetail(card, context)
      }
    })
  })
  void openLinkedCard(context)
}

/**
 * Opens the card named in the address. A key from before the card moved to another space (2.14) is
 * asked of the API, which answers with the card as it is now — and the address follows it there.
 */
const openLinkedCard = async (context: BoardContext): Promise<void> => {
  const key = new URLSearchParams(location.search).get('card')
  if (!key || document.querySelector('dialog[open].card-detail')) {
    return
  }
  const here = context.cards.find((each) => each.key === key)
  const card = here ?? (await read.cardByKey(key).catch(() => undefined))
  if (card && card.spaceId === context.spaceId) {
    openCardDetail(here ?? card, context)
  } else if (card) {
    navigate(`${spacePath(card.key.split('-')[0] ?? '')}?card=${card.key}`, true)
  }
}

const bindFilters = (root: HTMLElement, meId: string): void => {
  const search = root.querySelector<HTMLInputElement>('[data-board-search]')
  const mine = root.querySelector<HTMLButtonElement>('[data-only-mine]')
  const apply = () => {
    const query = (search?.value ?? '').trim().toLowerCase()
    const onlyMine = mine?.getAttribute('aria-pressed') === 'true'
    for (const card of root.querySelectorAll<HTMLElement>('.card-tile')) {
      const visible = (card.dataset.search ?? '').includes(query) && (!onlyMine || card.dataset.assignee === meId)
      card.toggleAttribute('hidden', !visible)
    }
  }

  search?.addEventListener('input', apply)
  mine?.addEventListener('click', () => {
    mine.setAttribute('aria-pressed', String(mine.getAttribute('aria-pressed') !== 'true'))
    apply()
  })
}

/** A board card as the card picker lists it, its state named from the workflow. */
const refOf = (card: Card, states: readonly State[]): CardRef => {
  const state = states.find((each) => each.id === card.stateId)
  return { ...card, state: { name: state?.name ?? '', group: state?.group ?? 'not_started' } }
}

/** While the board narrows to what is typed, the cards that match are suggested; one picked opens. */
const bindBoardSearch = (root: HTMLElement, context: BoardContext): void => {
  const box = root.querySelector<HTMLElement>('[data-board-search-box]')
  if (!box) {
    return
  }
  bindCardPicker(box, {
    accept: () => true,
    find: async (query) => cardsMatching(context.cards, query).map((card) => refOf(card, context.workflow.states)),
    onPick: (ref) => {
      const card = context.cards.find((each) => each.id === ref.id)
      if (card) {
        openCardDetail(card, context)
      }
    }
  })
}

const bindQuickAdd = (root: HTMLElement, spaceId: string): void => {
  for (const form of root.querySelectorAll<HTMLFormElement>('[data-quick-add]')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const input = form.querySelector('input') as HTMLInputElement
      const title = input.value.trim()
      if (!title) {
        return
      }
      refocus = form.dataset.quickAdd
      input.value = ''
      write
        .createCard(spaceId, { title, stateId: form.dataset.quickAdd ?? '' })
        .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    })
  }
  if (refocus) {
    root.querySelector<HTMLInputElement>(`[data-quick-add="${refocus}"] input`)?.focus()
    refocus = undefined
  }
}

/** A drop into another lane also changes the lane's field: another assignee, priority, type or parent. */
const laneChange = (context: BoardContext, card: Card, lane: string) => {
  const by = laneOf(context.spaceId)
  if (by === 'none') {
    return undefined
  }
  const field = LANE_FIELD[by]
  const current = {
    assigneeId: card.assignee?.id ?? '',
    priority: card.priority,
    typeId: card.typeId,
    parentId: card.parentId ?? ''
  }[field]
  if (current === lane || (field !== 'assigneeId' && field !== 'parentId' && !lane)) {
    return undefined
  }
  return { [field]: lane || null }
}

/**
 * Drag and drop between and within columns. The card moves on screen at once; the API is told where
 * it went, and a refusal puts the board back as the API sees it.
 */
const bindDragAndDrop = (root: HTMLElement, context: BoardContext): void => {
  if (!context.canWrite) {
    return
  }
  let dragged: HTMLElement | undefined
  const marker = document.createElement('li')
  marker.className = 'drop-marker'
  marker.setAttribute('aria-hidden', 'true')

  const others = (list: HTMLElement) =>
    [...list.querySelectorAll<HTMLElement>('.card-tile')].filter((card) => card !== dragged && !card.hidden)
  const indexIn = (list: HTMLElement, y: number) =>
    dropIndex(
      others(list).map((card) => card.getBoundingClientRect()),
      y
    )

  root.addEventListener('dragstart', (event) => {
    dragged = (event.target as HTMLElement).closest<HTMLElement>('.card-tile') ?? undefined
    event.dataTransfer?.setData('text/plain', dragged?.dataset.cardId ?? '')
    requestAnimationFrame(() => dragged?.classList.add('is-dragging'))
  })
  root.addEventListener('dragend', () => {
    dragged?.classList.remove('is-dragging')
    marker.remove()
    dragged = undefined
  })
  for (const list of root.querySelectorAll<HTMLElement>('[data-drop-state]')) {
    list.addEventListener('dragover', (event) => {
      event.preventDefault()
      const index = indexIn(list, event.clientY)
      list.insertBefore(marker, others(list)[index] ?? null)
    })
    list.addEventListener('drop', (event) => {
      event.preventDefault()
      const card = context.cards.find((each) => each.id === dragged?.dataset.cardId)
      if (!card || !dragged) {
        return
      }
      const index = indexIn(list, event.clientY)
      const lane = laneChange(context, card, list.dataset.lane ?? '')
      list.insertBefore(dragged, marker)
      marker.remove()
      write
        .moveCard(card, list.dataset.dropState ?? '', index)
        .then(() => (lane ? write.updateCard(card, lane) : undefined))
        .catch((refusal: unknown) => {
          toast(refusalSentence(refusal), 'error')
          invalidate(`space:${context.spaceId}:cards`)
        })
    })
  }
}

const createCard = (context: BoardContext): void =>
  openFormDialog({
    title: `Criar card em ${context.spaceKey}`,
    submit: 'Criar',
    done: 'Card criado.',
    fields: html`
      ${textField({ name: 'title', label: 'Título', required: true })}
      ${selectField({ name: 'typeId', label: 'Tipo', options: context.workflow.types.map((type) => ({ value: type.id, label: type.name })), value: context.workflow.types[0]?.id ?? '' })}
      ${selectField({ name: 'stateId', label: 'Estado', options: context.workflow.states.map((state) => ({ value: state.id, label: state.name })), value: context.workflow.states[0]?.id ?? '' })}
    `,
    onSubmit: (data) =>
      write.createCard(context.spaceId, {
        title: String(data.get('title')),
        typeId: String(data.get('typeId')),
        stateId: String(data.get('stateId'))
      })
  })

/**
 * Everything the board, the list and the backlog need, read together: the space's workflow, people and
 * fields, and its cards — those the filter lets through, when there is one. Every card is read too, so
 * the people a filter hides stay offered in it.
 */
export const loadBoard = async (spaceId: string, filter: CardFilter = {}) => {
  const [workflow, cards, every, members, roles, fields] = await Promise.all([
    read.workflow(spaceId),
    isEmpty(filter) ? read.cards(spaceId) : read.filteredCards(spaceId, filter),
    read.cards(spaceId),
    read.members(),
    read.spaceRoles(spaceId),
    read.fields(spaceId)
  ])
  const assignable = assignableIds(roles.items, every.items, filter)
  return { workflow, cards: cards.items, members: members.items, assignable, fields: fields.items }
}
