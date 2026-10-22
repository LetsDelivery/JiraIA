import { read, type Space, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { SPACE_TYPE_LABEL, SPACE_TYPE_OPTIONS, spacePath } from '@/lib/space-types'
import { icon } from '@/ui/icons'
import { selectField } from '@/ui/select'
import { openCreateSpace, openEditSpace } from '@/ui/space-dialogs'
import { toast } from '@/ui/toast'

import { canCreateSpaces } from './shell'
import type { View } from './view'

/** Dates are shown on the person's wall clock: São Paulo, as the whole company works. */
const DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

const STATUS_OPTIONS = [
  { value: 'active', label: 'Ativos' },
  { value: 'archived', label: 'Arquivados' },
  { value: 'all', label: 'Todos' }
]

const actions = (space: Space): Html =>
  space.archivedAt
    ? html`<button type="button" class="button button-ghost" data-restore="${space.id}">${icon('restore', 16)}Restaurar</button>`
    : html`
        <button type="button" class="button button-ghost button-icon" data-edit="${space.id}" aria-label="Editar ${space.name}" title="Editar">${icon('pencil', 16)}</button>
        <button type="button" class="button button-ghost button-icon" data-archive="${space.id}" aria-label="Arquivar ${space.name}" title="Arquivar">${icon('archive', 16)}</button>
      `

/** One row, carrying what the search and the filters match on, so filtering never re-renders. */
const row = (space: Space, manages: boolean): Html => {
  const url = `${location.host}${spacePath(space.key)}`

  return html`
    <tr
      data-search="${`${space.name} ${space.key}`.toLowerCase()}"
      data-type="${space.type}"
      data-lead="${space.lead?.id ?? ''}"
      data-status="${space.archivedAt ? 'archived' : 'active'}"
    >
      <td>${space.archivedAt ? html`${space.name} <span class="badge">arquivado</span>` : html`<a class="link" href="${spacePath(space.key)}">${space.name}</a>`}</td>
      <td><span class="key">${space.key}</span></td>
      <td>${SPACE_TYPE_LABEL[space.type]}</td>
      <td>${space.lead?.name ?? html`<span class="muted">—</span>`}</td>
      <td class="data muted">${space.lastCardActivityAt ? DATE.format(new Date(space.lastCardActivityAt)) : '—'}</td>
      <td><a class="url" href="${spacePath(space.key)}" title="${url}">${url}</a></td>
      ${manages ? html`<td class="actions">${actions(space)}</td>` : ''}
    </tr>
  `
}

const toolbar = (spaces: readonly Space[]): Html => {
  const leads = [
    ...new Map(spaces.flatMap((space) => (space.lead ? [[space.lead.id, space.lead.name]] : []))).entries()
  ]

  return html`
    <div class="toolbar">
      <label class="search">
        <span class="sr-only">Pesquisar espaços</span>
        <input type="search" class="input" data-search-input placeholder="Pesquisar por nome ou chave" />
      </label>
      ${selectField({ name: 'filter-type', label: 'Tipo', visibleLabel: false, options: [{ value: '', label: 'Todos os tipos' }, ...SPACE_TYPE_OPTIONS], value: '', attributes: html`data-filter="type"` })}
      ${selectField({ name: 'filter-lead', label: 'Líder', visibleLabel: false, options: [{ value: '', label: 'Todos os líderes' }, ...leads.map(([value, label]) => ({ value, label }))], value: '', attributes: html`data-filter="lead"` })}
      ${selectField({ name: 'filter-status', label: 'Situação', visibleLabel: false, options: STATUS_OPTIONS, value: 'active', attributes: html`data-filter="status"` })}
    </div>
  `
}

/**
 * Managing spaces, reached only from the gear beside Espaços: every space the caller can see, active
 * and archived, searchable and filterable, with the fields Jira's own space list shows.
 */
export const spacesView: View = {
  path: '/espacos',
  skeleton: 'table',
  title: 'Gerenciar espaços',
  render: async () => {
    const [me, active, archived] = await Promise.all([read.me(), read.spaces(), read.archivedSpaces()])
    const spaces = [...active.items, ...archived.items].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    const manages = me.isOrgAdmin

    return html`
      <header class="page-header row">
        <div class="stack-tight">
          <h1>Gerenciar espaços</h1>
          <p class="muted" data-count></p>
        </div>
        ${canCreateSpaces(me) ? html`<button type="button" class="button button-primary" data-create-space>${icon('plus')}Novo espaço</button>` : ''}
      </header>
      ${toolbar(spaces)}
      <table class="table spaces-table">
        <thead>
          <tr>
            <th>Nome</th><th>Chave</th><th>Tipo</th><th>Líder</th><th>Última atualização do ticket</th><th>URL do espaço</th>
            ${manages ? html`<th><span class="sr-only">Ações</span></th>` : ''}
          </tr>
        </thead>
        <tbody>${spaces.map((space) => row(space, manages))}</tbody>
      </table>
      <p class="empty muted" data-no-match hidden>Nenhum espaço corresponde à pesquisa e aos filtros.</p>
    `
  },
  bind: (root) => {
    bindFilters(root)
    bindActions(root)
  }
}

/** Shows the rows that match the search and every filter; counts them. */
const bindFilters = (root: HTMLElement): void => {
  const search = root.querySelector<HTMLInputElement>('[data-search-input]')
  const filterValue = (name: string) =>
    root.querySelector<HTMLInputElement>(`[data-filter="${name}"] input[type="hidden"]`)?.value ?? ''
  const rows = [...root.querySelectorAll<HTMLTableRowElement>('tbody tr')]

  const apply = () => {
    const query = (search?.value ?? '').trim().toLowerCase()
    const status = filterValue('status')
    const matches = (row: HTMLTableRowElement) =>
      (row.dataset.search ?? '').includes(query) &&
      (!filterValue('type') || row.dataset.type === filterValue('type')) &&
      (!filterValue('lead') || row.dataset.lead === filterValue('lead')) &&
      (status === 'all' || row.dataset.status === status)
    const shown = rows.filter((row) => !row.toggleAttribute('hidden', !matches(row)))

    root.querySelector('[data-no-match]')?.toggleAttribute('hidden', shown.length > 0)
    root.querySelector('[data-count]')?.replaceChildren(`${shown.length} ${shown.length === 1 ? 'espaço' : 'espaços'}`)
  }

  search?.addEventListener('input', apply)
  root.addEventListener('select-change', apply)
  apply()
}

const bindActions = (root: HTMLElement): void => {
  const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
  const spaceOf = async (spaceId: string) => (await read.spaces()).items.find((space) => space.id === spaceId)

  root.querySelector('[data-create-space]')?.addEventListener('click', () => void openCreateSpace())
  for (const button of root.querySelectorAll<HTMLElement>('[data-edit]')) {
    button.addEventListener('click', async () => {
      const space = await spaceOf(button.dataset.edit ?? '')
      if (space) {
        await openEditSpace(space)
      }
    })
  }
  for (const button of root.querySelectorAll<HTMLElement>('[data-archive], [data-restore]')) {
    const archiving = button.hasAttribute('data-archive')
    button.addEventListener('click', () =>
      write
        .archiveSpace(button.dataset.archive ?? button.dataset.restore ?? '', archiving)
        .then(() => toast(archiving ? 'Espaço arquivado.' : 'Espaço restaurado.'))
        .catch(refuse)
    )
  }
}
