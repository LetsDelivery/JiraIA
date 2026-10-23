import type { Widget } from '@/api/reports'
import type { SavedView } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { GROUPING_LABEL, INTERVAL_LABEL, suggestedTitle, titleOf, WIDTH_LABEL, WIDTHS } from '@/lib/reports'

import { openEditorDialog } from './editor-dialog'
import { type IconName, icon } from './icons'
import { type SelectOption, selectField } from './select'

/**
 * Adding and changing a widget of the Relatórios tab (ADR-0016): a catalog to pick from, as Jira's
 * "Adicionar widget", then the form for the widget picked. Nothing is saved here — the widget goes
 * into the dashboard being edited, which is saved as a whole.
 */
type Entry = { label: string; description: string; icon: IconName; make: () => Widget }

const id = (): string => crypto.randomUUID()

export const CATALOG: readonly Entry[] = [
  {
    label: 'Gráfico',
    description: 'Crie um gráfico do zero: rosca ou barras, agrupando os itens como quiser.',
    icon: 'chartBar',
    make: () => ({ id: id(), kind: 'breakdown', by: 'state', chart: 'bars', width: 'half' })
  },
  {
    label: 'Número',
    description: 'Quantos itens foram criados, atualizados ou concluídos, ou vencem em breve.',
    icon: 'hash',
    make: () => ({ id: id(), kind: 'count', measure: 'completed', days: 7, width: 'quarter' })
  },
  {
    label: 'Itens por estado',
    description: 'Quantos itens há em cada estado do fluxo.',
    icon: 'chartDonut',
    make: () => ({ id: id(), kind: 'breakdown', by: 'state', chart: 'donut', width: 'third' })
  },
  {
    label: 'Itens por responsável',
    description: 'Quantos itens cada pessoa tem.',
    icon: 'chartDonut',
    make: () => ({ id: id(), kind: 'breakdown', by: 'assignee', chart: 'donut', width: 'third' })
  },
  {
    label: 'Tendência',
    description: 'Itens criados ou concluídos por dia, semana ou mês.',
    icon: 'chartBar',
    make: () => ({ id: id(), kind: 'trend', measure: 'created', interval: 'day', days: 30, width: 'half' })
  },
  {
    label: 'Tempo de ciclo',
    description: 'Quanto os itens levam da primeira entrada em andamento até a conclusão.',
    icon: 'chartLine',
    make: () => ({ id: id(), kind: 'timing', measure: 'cycle', interval: 'week', days: 90, width: 'half' })
  },
  {
    label: 'Lead time',
    description: 'Quanto os itens levam da criação até a conclusão.',
    icon: 'chartLine',
    make: () => ({ id: id(), kind: 'timing', measure: 'lead', interval: 'week', days: 90, width: 'half' })
  },
  {
    label: 'Estado por responsável',
    description: 'Quantos itens cada pessoa tem em cada estado.',
    icon: 'table',
    make: () => ({ id: id(), kind: 'matrix', by: 'assignee', width: 'full' })
  },
  {
    label: 'Lista de itens',
    description: 'Os itens, com tipo, prioridade, estado e responsável.',
    icon: 'listDetails',
    make: () => ({ id: id(), kind: 'cards', width: 'full' })
  },
  {
    label: 'Burndown da sprint',
    description: 'Quanto falta da sprint ativa, dia a dia, contra a linha ideal. Para espaços com sprints.',
    icon: 'chartLine',
    make: () => ({ id: id(), kind: 'burndown', width: 'half' })
  },
  {
    label: 'Velocidade',
    description: 'Comprometido e concluído nas últimas sprints encerradas, e a média. Para espaços com sprints.',
    icon: 'chartBar',
    make: () => ({ id: id(), kind: 'velocity', sprints: 6, width: 'half' })
  }
]

/** Catalog entries whose name or description holds `query`, accents ignored. */
export const searchCatalog = (query: string): readonly Entry[] => {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const wanted = fold(query.trim())
  return wanted ? CATALOG.filter((each) => fold(`${each.label} ${each.description}`).includes(wanted)) : CATALOG
}

const _entries = (entries: readonly Entry[]): Html =>
  entries.length
    ? html`${entries.map(
        (entry) => html`<li><button type="button" class="catalog-entry" data-entry="${CATALOG.indexOf(entry)}">
          <span class="catalog-icon">${icon(entry.icon, 20)}</span>
          <span><strong>${entry.label}</strong><small class="muted">${entry.description}</small></span>
        </button></li>`
      )}`
    : html`<li class="muted">Nenhum widget com esse nome.</li>`

/** The catalog, in a dialog of its own: picking an entry opens its form. */
export const openCatalog = (onPick: (widget: Widget) => void): void => {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog glass catalog-dialog'
  dialog.setAttribute('aria-label', 'Adicionar widget')
  dialog.innerHTML = html`
    <header class="dialog-header">
      <h2>Adicionar widget</h2>
      <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button>
    </header>
    <div class="dialog-body">
      <p class="muted">Escolha o que o widget mostra. Depois dá para mudar o título, a largura e a visão.</p>
      <input class="input" type="search" placeholder="Pesquisar widgets" aria-label="Pesquisar widgets" data-catalog-search />
      <ul class="catalog-list" data-catalog>${_entries(CATALOG)}</ul>
    </div>
  `.value
  const close = () => dialog.remove()
  dialog.querySelector('[data-close]')?.addEventListener('click', close)
  dialog.addEventListener('cancel', close)
  _bindCatalog(dialog, (entry) => {
    close()
    onPick(entry.make())
  })
  document.body.append(dialog)
  dialog.showModal()
}

const _bindCatalog = (dialog: HTMLElement, pick: (entry: Entry) => void) => {
  const list = dialog.querySelector('[data-catalog]') as HTMLElement
  dialog.querySelector('[data-catalog-search]')?.addEventListener('input', (event) => {
    list.innerHTML = _entries(searchCatalog((event.target as HTMLInputElement).value)).value
  })
  list.addEventListener('click', (event) => {
    const entry = CATALOG[Number((event.target as HTMLElement).closest<HTMLElement>('[data-entry]')?.dataset.entry)]
    if (entry) {
      pick(entry)
    }
  })
}

const options = (labels: Record<string, string>): SelectOption[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }))

const PERIODS = options({
  '7': '7 dias',
  '14': '14 dias',
  '30': '30 dias',
  '90': '90 dias',
  '180': '6 meses',
  '365': '1 ano'
})
const COUNT_PERIODS = options({ '1': '1 dia', '7': '7 dias', '14': '14 dias', '30': '30 dias' })

const select = (name: string, label: string, choices: SelectOption[], value: string | number): Html =>
  selectField({ name, label, options: choices, value: String(value) })

/** The fields only one kind of widget has. */
const KIND_FIELDS: { [K in Widget['kind']]: (draft: Extract<Widget, { kind: K }>) => Html } = {
  count: (draft) => html`
    ${select('measure', 'Conta os itens', options({ completed: 'Concluídos', updated: 'Atualizados', created: 'Criados', due_soon: 'Que vencem em breve' }), draft.measure)}
    ${select('days', 'Período', COUNT_PERIODS, draft.days)}`,
  breakdown: (draft) => html`
    ${select('by', 'Agrupar por', options(GROUPING_LABEL), draft.by)}
    ${select('chart', 'Forma', options({ donut: 'Rosca', bars: 'Barras' }), draft.chart)}`,
  trend: (draft) => html`
    ${select('measure', 'Itens', options({ created: 'Criados', completed: 'Concluídos' }), draft.measure)}
    ${select('interval', 'Por', options(INTERVAL_LABEL), draft.interval)}
    ${select('days', 'Período', PERIODS, draft.days)}`,
  timing: (draft) => html`
    ${select('measure', 'Tempo', options({ cycle: 'Tempo de ciclo', lead: 'Lead time' }), draft.measure)}
    ${select('interval', 'Por', options(INTERVAL_LABEL), draft.interval)}
    ${select('days', 'Período', PERIODS, draft.days)}`,
  matrix: (draft) =>
    select(
      'by',
      'Linhas',
      options({ assignee: GROUPING_LABEL.assignee, squad: GROUPING_LABEL.squad, type: GROUPING_LABEL.type }),
      draft.by
    ),
  cards: () => html``,
  burndown: () => html``,
  velocity: (draft) =>
    select(
      'sprints',
      'Sprints',
      options({ '3': 'Últimas 3', '6': 'Últimas 6', '9': 'Últimas 9', '12': 'Últimas 12' }),
      draft.sprints
    )
}

/** A sprint widget reads the sprint itself, never a view's cards (ADR-0029). */
const SPRINT_KINDS = new Set<Widget['kind']>(['burndown', 'velocity'])

const _form = (draft: Widget, views: readonly SavedView[]): Html => html`
  <div class="field"><label for="widget-title">Título</label>
    <input id="widget-title" class="input" data-widget-title maxlength="80" value="${draft.title ?? ''}" placeholder="${suggestedTitle(draft)}" />
    <p class="field-hint">Em branco, o widget usa o nome sugerido.</p></div>
  ${(KIND_FIELDS[draft.kind] as (each: Widget) => Html)(draft)}
  ${select(
    'width',
    'Largura',
    WIDTHS.map((width) => ({ value: width, label: WIDTH_LABEL[width] })),
    draft.width
  )}
  ${SPRINT_KINDS.has(draft.kind) ? '' : select('viewId', 'Itens', [{ value: '', label: 'Todos os itens do espaço' }, ...views.map((view) => ({ value: view.id, label: `Visão: ${view.name}` }))], draft.viewId ?? '')}
`

const NUMERIC = new Set(['days', 'sprints'])

/** A value chosen in the form, written into the draft: numbers as numbers, "none" as absent. */
const _set = (draft: Widget, name: string, value: string) => {
  const fields = draft as Record<string, unknown>
  if ((name === 'viewId' || name === 'title') && !value) {
    delete fields[name]
    return
  }
  fields[name] = NUMERIC.has(name) ? Number(value) : value
}

/** The form of one widget: a new one from the catalog, or one already on the dashboard. */
export const openWidgetEditor = (input: {
  widget: Widget
  isNew: boolean
  views: readonly SavedView[]
  onDone: (widget: Widget) => void
}): void => {
  const draft: Widget = structuredClone(input.widget)
  openEditorDialog({
    title: input.isNew ? 'Novo widget' : `Editar ${titleOf(input.widget)}`,
    submit: input.isNew ? 'Adicionar' : 'Aplicar',
    done: input.isNew
      ? 'Widget adicionado. Salve o painel para manter.'
      : 'Widget alterado. Salve o painel para manter.',
    body: () => _form(draft, input.views),
    bind: (root) => {
      root.addEventListener('select-change', (event) => {
        const input = (event.target as HTMLElement).querySelector<HTMLInputElement>('input[type="hidden"]')
        if (input) {
          _set(draft, input.name, input.value)
        }
      })
      root.querySelector('[data-widget-title]')?.addEventListener('input', (event) => {
        _set(draft, 'title', (event.target as HTMLInputElement).value.trim())
      })
    },
    onSubmit: async () => input.onDone(_clean(draft))
  })
}

/** A copy that leaves the dialog: later edits of the draft must not reach the dashboard. */
const _clean = (draft: Widget): Widget => structuredClone(draft)
