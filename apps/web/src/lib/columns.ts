/**
 * The list's columns (escopo-mvp 3.2): the standard fields and every custom field of the space. Which
 * ones show is the viewer's choice, per space; saved views of Etapa 3 will carry it for a team.
 */
export const STANDARD_COLUMNS = [
  'key',
  'title',
  'type',
  'state',
  'assignee',
  'reporter',
  'priority',
  'labels',
  'dueDate',
  'estimate',
  'createdAt',
  'updatedAt'
] as const
export type StandardColumn = (typeof STANDARD_COLUMNS)[number]

export const COLUMN_LABEL: Record<StandardColumn, string> = {
  key: 'Chave',
  title: 'Título',
  type: 'Tipo',
  state: 'Estado',
  assignee: 'Responsável',
  reporter: 'Relator',
  priority: 'Prioridade',
  labels: 'Labels',
  dueDate: 'Data limite',
  estimate: 'Estimativa',
  createdAt: 'Criado em',
  updatedAt: 'Atualizado em'
}

export const DEFAULT_COLUMNS: readonly string[] = ['key', 'title', 'type', 'state', 'assignee', 'priority', 'dueDate']

/**
 * A column toggled on or off, keeping the order the columns are offered in.
 *
 * @example toggleColumn(['key', 'title'], 'state', ['key', 'title', 'state'])   // ['key', 'title', 'state']
 */
export const toggleColumn = (shown: readonly string[], column: string, offered: readonly string[]): string[] => {
  const next = shown.includes(column) ? shown.filter((each) => each !== column) : [...shown, column]
  return offered.filter((each) => next.includes(each))
}

/** Sorts rows by the text a column shows; empty values last, either way. */
export const sortRows = <R>(rows: readonly R[], text: (row: R) => string, descending: boolean): R[] =>
  [...rows].sort((a, b) => _compare(text(a), text(b), descending))

const _compare = (x: string, y: string, descending: boolean): number => {
  if (!(x && y)) {
    return Number(!x) - Number(!y)
  }
  const order = x.localeCompare(y, 'pt-BR', { numeric: true })
  return descending ? -order : order
}
