import { read } from '@/api/requests'
import { html } from '@/lib/html'
import { spaceGrid } from '@/ui/space-card'

import type { View } from './view'

/**
 * The filters of "your tasks". Each one is a question about cards, which arrive in Etapa 2: until
 * then every tab says what it will hold, so this is the screen that ships and nothing is redone.
 */
const TASK_FILTERS = [
  { value: 'worked', label: 'Trabalhados', empty: 'Os cards que você criou, alterou ou comentou nos últimos 30 dias.' },
  { value: 'viewed', label: 'Vistos', empty: 'Os cards que você abriu recentemente.' },
  { value: 'assigned', label: 'Atribuídos a mim', empty: 'Os cards abertos em que você é o responsável.' },
  { value: 'starred', label: 'Marcados com estrela', empty: 'Os cards que você marcou com estrela.' },
  { value: 'recommended', label: 'Recomendados', empty: 'Cards dos seus espaços que pedem a sua atenção.' }
] as const

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
        <div role="tabpanel" id="panel-${filter.value}" aria-labelledby="tab-${filter.value}" class="empty" ${index === 0 ? '' : html`hidden`}>
          <p class="empty-title">Nenhuma tarefa ainda</p>
          <p class="muted">${filter.empty} Os cards chegam na próxima etapa do JiraIA.</p>
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

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }

/** A tablist: click or arrow keys choose a tab, and only the chosen panel is shown. */
const bindTabs = (root: HTMLElement): void => {
  const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')]
  const select = (chosen: HTMLElement) => {
    for (const tab of tabs) {
      const on = tab === chosen
      tab.setAttribute('aria-selected', String(on))
      tab.tabIndex = on ? 0 : -1
      root.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`)?.toggleAttribute('hidden', !on)
    }
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
}
