import { type MyCard, type MyCardTab, read } from '@/api/requests'
import { PRIORITY_ICON, PRIORITY_LABEL } from '@/lib/cards'
import { dayMonth, isPast } from '@/lib/dates'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { spaceKeyOf } from '@/lib/search'
import { spacePath } from '@/lib/space-types'
import { icon } from '@/ui/icons'
import { spaceGrid } from '@/ui/space-card'

import type { View } from './view'

/** The filters of "your tasks": each tab asks the API for what it lists the first time it is chosen. */
const TASK_FILTERS: readonly { value: MyCardTab; label: string; empty: string }[] = [
  { value: 'assigned', label: 'Atribuídos a mim', empty: 'Os cards abertos em que você é o responsável.' },
  { value: 'starred', label: 'Marcados com estrela', empty: 'Os cards que você marcou com estrela.' },
  {
    value: 'recommended',
    label: 'Recomendados',
    empty: 'Cards da sprint ativa dos seus espaços que ainda não começaram, sem bloqueio e sem outro responsável.'
  }
]

const cardHref = (key: string): string => `${spacePath(spaceKeyOf(key))}?card=${key}`

/** A due date still open past its day reads in the accent, as on a board tile; a finished card's never does. */
const due = (card: MyCard): Html => {
  if (!card.dueDate) {
    return html``
  }
  const late = isPast(card.dueDate) && card.state.group !== 'done' && card.state.group !== 'cancelled'
  return html`<span class="my-card-due ${late ? 'is-late' : ''}">${icon('calendar', 14)}${dayMonth(card.dueDate)}</span>`
}

const cardLine = (card: MyCard): Html => html`
  <li class="search-result">
    <a class="search-result-link" href="${cardHref(card.key)}">
      <span class="priority priority-${card.priority}" title="Prioridade ${PRIORITY_LABEL[card.priority]}">${icon(PRIORITY_ICON[card.priority], 16)}</span>
      <span class="card-key">${card.key}</span>
      <span class="search-result-title">${card.title}</span>
      ${due(card)}
      <span class="my-card-assignee muted">${card.assignee?.name ?? 'Sem responsável'}</span>
      <span class="state-chip"><span class="group-dot group-${card.state.group}" aria-hidden="true"></span>${card.state.name}</span>
    </a>
  </li>
`

const cardList = (cards: readonly MyCard[], empty: string): Html =>
  cards.length
    ? html`<ul class="search-results">${cards.map(cardLine)}</ul>`
    : html`<div class="empty"><p class="empty-title">Nenhum card aqui ainda</p><p class="muted">${empty}</p></div>`

const tasks = html`
  <section class="section">
    <h2>Suas tarefas</h2>
    <div class="tabs" role="tablist" aria-label="Filtros das tarefas">
      ${TASK_FILTERS.map(
        (filter, index) => html`
          <button type="button" role="tab" id="tab-${filter.value}" class="tab" aria-selected="${index === 0}"
            aria-controls="panel-${filter.value}" tabindex="${index === 0 ? 0 : -1}">${filter.label}</button>
        `
      )}
    </div>
    ${TASK_FILTERS.map(
      (filter, index) => html`
        <div role="tabpanel" id="panel-${filter.value}" aria-labelledby="tab-${filter.value}" class="my-cards"
          data-tab="${filter.value}" aria-busy="true" ${index === 0 ? '' : html`hidden`}>
          <p class="muted">Carregando…</p>
        </div>
      `
    )}
  </section>
`

/** Where a person lands: the spaces they use most, and their tasks. */
export const forYouView: View = {
  path: '/',
  title: 'Para você',
  render: async () => {
    const [me, mine] = await Promise.all([read.me(), read.mySpaces()])
    const fallback = mine.starred.length
      ? 'Todos os seus espaços já estão marcados com estrela.'
      : 'Nenhum espaço criado ainda.'

    return html`
      <header class="page-header">
        <h1>Para você</h1>
        <p class="muted">Olá, ${me.name.split(' ')[0]}.</p>
      </header>
      <section class="section">
        <h2>Espaços recomendados</h2>
        ${mine.recommended.length > 0 ? spaceGrid(mine.recommended) : html`<p class="muted">${fallback}</p>`}
      </section>
      ${tasks}
    `
  },
  bind: (root) => bindTabs(root)
}

/** A panel's cards, asked for once: the first time its tab is shown. */
const fill = (panel: HTMLElement): void => {
  const filter = TASK_FILTERS.find((each) => each.value === panel.dataset.tab)
  if (!filter || panel.dataset.loaded) {
    return
  }
  panel.dataset.loaded = 'true'
  read
    .myCards(filter.value)
    .then((found) => {
      panel.innerHTML = cardList(found.items, filter.empty).value
    })
    .catch((refusal: unknown) => {
      panel.innerHTML = html`<p class="muted">${refusalSentence(refusal)}</p>`.value
    })
    .finally(() => panel.removeAttribute('aria-busy'))
}

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }

/** A tablist: click or arrow keys choose a tab, and only the chosen panel is shown. */
const bindTabs = (root: HTMLElement): void => {
  const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')]
  const panelOf = (tab: HTMLElement) => root.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`)
  const select = (chosen: HTMLElement) => {
    for (const tab of tabs) {
      const on = tab === chosen
      tab.setAttribute('aria-selected', String(on))
      tab.tabIndex = on ? 0 : -1
      panelOf(tab)?.toggleAttribute('hidden', !on)
    }
    const panel = panelOf(chosen)
    panel && fill(panel)
    chosen.focus()
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab))
    tab.addEventListener('keydown', (event) => {
      const step = ARROWS[event.key] ?? 0
      const next = tabs[(index + step + tabs.length) % tabs.length]
      if (step && next) {
        select(next)
      }
    })
  }
  const first = tabs[0] && panelOf(tabs[0])
  first && fill(first)
}
