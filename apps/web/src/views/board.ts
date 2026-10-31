import { cardDetailRead } from '@/api/card-detail'
import {
  type Card,
  type CardRef,
  type Field,
  type Label,
  type Member,
  read,
  type Space,
  type State,
  type Workflow,
  write
} from '@/api/requests'
import { type Sprint, sprintsRead } from '@/api/sprints'
import { type BoardColumn as Column, columnsOf } from '@/lib/board-columns'
import { invalidate } from '@/lib/cache'
import { dropIndex } from '@/lib/cards'
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
import { bindTileEdits, tile } from '@/ui/card-tile'
import { openFormDialog, textField } from '@/ui/dialog'
import { icon } from '@/ui/icons'
import { selectField } from '@/ui/select'
import { bindSprintStrip, type SprintScope, shownSprint, sprintStrip } from '@/ui/sprint-strip'
import { toast } from '@/ui/toast'

export type BoardContext = {
  spaceId: string
  spaceKey: string
  /** Whether it plans in sprints, and how it estimates (ADR-0029). */
  space: Pick<Space, 'name' | 'usesSprints' | 'estimation'>
  /** Its sprints, none when it does not use them. */
  sprints: readonly Sprint[]
  workflow: Workflow
  cards: readonly Card[]
  fields: readonly Field[]
  members: readonly Member[]
  /** Who the Responsável filter offers: the space's people, not the whole organization (`assignableIds`). */
  assignable: ReadonlySet<string>
  /** The space's labels with their colours (ADR-0032) — what the label pickers offer, filter or not. */
  labels: readonly Label[]
  meId: string
  canWrite: boolean
  manages: boolean
  /** A filter narrows `cards` (3.4); orders that need every card, as the backlog's, wait until it is cleared. */
  filtered: boolean
  /** The Lista without its old done cards (ADR-0040): how many it left out, `null` when uncounted. */
  oldDone?: { hidden: number | null } | undefined
}

/** Swimlanes are a viewer's preference, per space, on this browser. */
const lanePreference = persistedStore<Record<string, LaneBy>>('jiraia.board.lanes', {})
export const laneOf = (spaceId: string): LaneBy => lanePreference.get()[spaceId] ?? 'none'

/** A saved view opens with its own lanes (3.5). */
export const setLanes = (spaceId: string, lanes: LaneBy): void => {
  lanePreference.set({ ...lanePreference.get(), [spaceId]: lanes })
}

/** What every tile of the board needs from it: whether cards can be changed, and the types they wear. */
type Drawing = Pick<BoardContext, 'canWrite' | 'workflow' | 'labels'>

const firstOf = (column: Column): State => column.states[0] as State

/** A column's cards, grouped by its states in workflow order, each state's in board order. */
const inColumn = (cards: readonly Card[], column: Column): Card[] =>
  column.states.flatMap((state) => cards.filter((card) => card.stateId === state.id))

const cardsList = (column: Column, cards: readonly Card[], drawing: Drawing, lane: string): Html => html`
  <ol class="column-cards" data-drop-state="${firstOf(column).id}" data-column-states="${column.states.map((state) => state.id).join(' ')}"
    data-lane="${lane}" aria-label="${column.name}">${cards.map((card) => {
      const state = column.states.find((each) => each.id === card.stateId) ?? firstOf(column)
      return tile(card, {
        canWrite: drawing.canWrite,
        group: state.group,
        labels: drawing.labels,
        type: drawing.workflow.types.find((type) => type.id === card.typeId),
        state: column.states.length > 1 ? state.name : undefined
      })
    })}</ol>
`

const columnHead = (column: Column, total: number): Html => html`
  <header class="column-head">
    <span class="group-dot group-${firstOf(column).group}" aria-hidden="true"></span>
    <h3>${column.name}</h3>
    <span class="count">${total}</span>
  </header>
`

const quickAdd = (column: Column): Html => html`
  <form class="quick-add" data-quick-add="${firstOf(column).id}">
    <input class="input quick-add-input" name="title" placeholder="+ Criar card" aria-label="Novo card em ${column.name}" maxlength="255" />
  </form>
`

const columnOf = (column: Column, cards: readonly Card[], drawing: Drawing): Html => html`
  <section class="column" aria-label="${column.name}">
    ${columnHead(column, cards.length)}
    ${cardsList(column, cards, drawing, '')}
    ${drawing.canWrite ? quickAdd(column) : ''}
  </section>
`

/** The board in lanes: column heads once on top, then one row of columns per lane (escopo-mvp 3.1). */
const laned = (context: BoardContext, lanes: Lane<Card>[]): Html => {
  const columns = columnsOf(context.workflow)
  return html`
    <div class="board board-laned" style="--columns: ${columns.length}">
      ${columns.map((column) => html`<div class="column column-top">${columnHead(column, inColumn(context.cards, column).length)}</div>`)}
      ${lanes.map(
        (lane) => html`
          <h4 class="lane-title">${lane.label} <span class="count">${lane.cards.length}</span></h4>
          ${columns.map((column) => html`<div class="column column-lane">${cardsList(column, inColumn(lane.cards, column), context, lane.value)}</div>`)}
        `
      )}
    </div>
  `
}

const LANE_OPTIONS = LANE_BY.map((by) => ({ value: by, label: LANE_LABEL[by] }))

/**
 * The cards the board shows: the sprint on screen's, or every card of a space without sprints
 * (ADR-0029) — never a sub-task's, which belongs under its parent, as on a Jira board (ADR-0037).
 */
const boardScope = (context: BoardContext): { cards: readonly Card[]; sprint: Sprint | undefined } => {
  const subtasks = new Set(context.workflow.types.filter((type) => type.isSubtask).map((type) => type.id))
  const drawn = context.cards.filter((card) => !subtasks.has(card.typeId))
  if (!context.space.usesSprints) {
    return { cards: drawn, sprint: undefined }
  }
  const sprint = shownSprint(context.sprints, new URLSearchParams(location.search).get('sprint'))
  return { cards: sprint ? drawn.filter((card) => card.sprintId === sprint.id) : drawn, sprint }
}

const scopeOf = (context: BoardContext, cards: readonly Card[]): SprintScope => ({
  sprints: context.sprints,
  cards,
  states: context.workflow.states,
  points: context.space.estimation === 'points',
  canWrite: context.canWrite
})

/** The kanban: the space's board columns, or one per state, optionally in lanes (escopo-mvp 3.1, ADR-0037). */
export const board = (context: BoardContext): Html => {
  const by = laneOf(context.spaceId)
  const { cards, sprint } = boardScope(context)
  const names = { types: context.workflow.types, cards }
  return html`
    ${context.space.usesSprints ? sprintStrip(scopeOf(context, cards), sprint) : ''}
    <div class="toolbar">
      <div class="search card-picker" data-board-search-box>
        <label class="sr-only" for="board-search">Pesquisar cards</label>
        <input id="board-search" type="search" class="input" data-board-search placeholder="Pesquisar por título ou chave"
          autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="board-search-list" aria-expanded="false" />
        <ul class="select-menu glass card-picker-menu" role="listbox" id="board-search-list" hidden></ul>
      </div>
      <button type="button" class="button button-secondary" data-only-mine aria-pressed="false">${icon('user', 16)}Só os meus</button>
      ${selectField({ name: 'lanes', label: 'Raias', visibleLabel: false, options: LANE_OPTIONS, value: by, attributes: html`data-lanes` })}
      ${context.canWrite ? html`<button type="button" class="button button-primary" data-create-card>${icon('plus')}Criar card</button>` : ''}
    </div>
    ${
      by === 'none'
        ? html`<div class="board">${columnsOf(context.workflow).map((column) => columnOf(column, inColumn(cards, column), context))}</div>`
        : laned({ ...context, cards }, lanesOf(cards, by, names))
    }
  `
}

/** The quick-add input to focus again after the board re-renders, so cards can be typed one after another. */
let refocus: string | undefined

export const bindBoard = (root: HTMLElement, context: BoardContext): void => {
  if (context.space.usesSprints) {
    const { cards, sprint } = boardScope(context)
    bindSprintStrip(root, scopeOf(context, cards), sprint)
  }
  bindFilters(root, context.meId)
  bindBoardSearch(root, context)
  bindDragAndDrop(root, context)
  bindQuickAdd(root, context)
  bindOpenCards(root, context)
  bindTileEdits(root, context)
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
    warmOnRest(button, button.dataset.openCard ?? '')
    button.addEventListener('click', () => {
      const card = context.cards.find((each) => each.id === button.dataset.openCard)
      if (card) {
        openCardDetail(card, context)
      }
    })
  })
  void openLinkedCard(context)
}

/** Resting on a card a moment starts loading its page, so the click finds it on its way (ADR-0041). */
const warmOnRest = (button: HTMLElement, cardId: string): void => {
  let timer: ReturnType<typeof setTimeout> | undefined
  button.addEventListener('pointerenter', () => {
    timer = setTimeout(() => cardDetailRead.warm(cardId), 120)
  })
  button.addEventListener('pointerleave', () => clearTimeout(timer))
  button.addEventListener('focus', () => cardDetailRead.warm(cardId))
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

/** A card created on a sprint's board starts in that sprint, so it stays on screen (ADR-0029). */
const sprintOfBoard = (context: BoardContext): { sprintId?: string } => {
  const sprint = boardScope(context).sprint
  return sprint && sprint.state !== 'closed' ? { sprintId: sprint.id } : {}
}

const bindQuickAdd = (root: HTMLElement, context: BoardContext): void => {
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
        .createCard(context.spaceId, { title, stateId: form.dataset.quickAdd ?? '', ...sprintOfBoard(context) })
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
        .moveCard(card, dropTarget(list, card), index)
        .then(() => (lane ? write.updateCard(card, lane) : undefined))
        .catch((refusal: unknown) => {
          toast(refusalSentence(refusal), 'error')
          invalidate(`space:${context.spaceId}:cards`)
        })
    })
  }
}

/** A card keeps its state when dropped in the column that already holds it; elsewhere it takes the column's first. */
const dropTarget = (list: HTMLElement, card: Card): string => {
  const states = (list.dataset.columnStates ?? '').split(' ')
  return states.includes(card.stateId) ? card.stateId : (list.dataset.dropState ?? '')
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
        stateId: String(data.get('stateId')),
        ...sprintOfBoard(context)
      })
  })

/**
 * Everything the board, the list and the backlog need, read together: the space's workflow, people and
 * fields, and its cards — those the filter lets through, when there is one. Every card is read too, so
 * the people a filter hides stay offered in it.
 */
/** The cards a filter lets through; with `doneSince`, without those done before it (ADR-0040). */
const cardsOf = (spaceId: string, filter: CardFilter, doneSince: string | undefined) => {
  if (!isEmpty(filter)) {
    return read.filteredCards(spaceId, doneSince ? { ...filter, doneSince } : filter)
  }
  return doneSince ? read.recentCards(spaceId, doneSince) : read.cards(spaceId)
}

export const loadBoard = async (spaceId: string, filter: CardFilter = {}, doneSince?: string) => {
  const [workflow, cards, every, members, roles, fields, space, catalogue] = await Promise.all([
    read.workflow(spaceId),
    cardsOf(spaceId, filter, doneSince),
    read.cards(spaceId),
    read.members(),
    read.spaceRoles(spaceId),
    read.fields(spaceId),
    read.space(spaceId),
    read.labels(spaceId)
  ])
  const assignable = assignableIds(roles.items, every.items, filter)
  const sprints = space.usesSprints ? (await sprintsRead.list(spaceId)).items : []
  return {
    workflow,
    cards: cards.items,
    members: members.items,
    assignable,
    labels: catalogue.items,
    fields: fields.items,
    space,
    sprints,
    oldDone: doneSince ? { hidden: isEmpty(filter) ? every.items.length - cards.items.length : null } : undefined
  }
}
