import type { ItemInput, ItemKind, Proposal, ProposalItem } from '@/api/proposals'

/** What a proposal asks, said the way the screen says it (ADR-0019). */
export const KIND_LABEL: Record<ItemKind, string> = {
  create_card: 'Criar card',
  update_card: 'Alterar card',
  comment: 'Comentar',
  link: 'Vincular cards'
}

export const STATUS_LABEL: Record<Proposal['status'], string> = {
  pending: 'Pendente',
  applied: 'Aplicada',
  rejected: 'Recusada',
  withdrawn: 'Retirada pelo agente',
  reverted: 'Revertida',
  expired: 'Vencida'
}

export const ITEM_STATUS_LABEL: Record<ProposalItem['status'], string> = {
  pending: 'Aguardando',
  applied: 'Aplicada',
  failed: 'Falhou',
  declined: 'Não aplicada',
  reverted: 'Revertida'
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Título',
  description: 'Descrição',
  typeId: 'Tipo',
  stateId: 'Estado',
  assigneeId: 'Responsável',
  groupId: 'Squad',
  priority: 'Prioridade',
  labels: 'Labels',
  dueDate: 'Entrega',
  estimate: 'Estimativa',
  parentId: 'Card pai',
  body: 'Comentário',
  link: 'Vínculo'
}

const PRIORITY_LABEL: Record<string, string> = {
  highest: 'Altíssima',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
  lowest: 'Baixíssima'
}

const LINK_LABEL: Record<string, string> = {
  relates: 'relaciona-se com',
  blocks: 'bloqueia',
  duplicates: 'duplica',
  delivers: 'entrega',
  causes: 'causa'
}

/**
 * A field as the screen names it; a custom one by its name in `names`.
 *
 * @example fieldLabel('field:f1', { f1: 'Impacto' })   // 'Impacto'
 */
export const fieldLabel = (field: string, names: Record<string, string>): string =>
  field.startsWith('field:') ? (names[field.slice(6)] ?? 'Campo') : (FIELD_LABEL[field] ?? field)

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

const linkText = (value: unknown): string => {
  const link = value as { type: string; direction: string; card: string | null }
  const verb = LINK_LABEL[link.type] ?? link.type
  return link.direction === 'outward' ? `${verb} ${link.card ?? ''}` : `${link.card ?? ''} ${verb} este card`
}

/**
 * A value as a person reads it: ids by their names, priorities in pt-BR, empty as a dash.
 *
 * @example valueText('priority', 'high', {})   // 'Alta'
 */
export const valueText = (field: string, value: unknown, names: Record<string, string>): string => {
  if (isEmpty(value)) {
    return '—'
  }
  if (Array.isArray(value)) {
    return value.map((each) => valueText(field, each, names)).join(', ')
  }
  if (field === 'link') {
    return linkText(value)
  }
  if (field === 'priority') {
    return PRIORITY_LABEL[String(value)] ?? String(value)
  }
  return typeof value === 'string' ? (names[value] ?? value) : JSON.stringify(value)
}

/** Which parts of an item an approver may rewrite before approving: text, never the ids. */
export const ADJUSTABLE: Record<ItemKind, readonly string[]> = {
  create_card: ['title', 'description'],
  update_card: ['title', 'description'],
  comment: ['body'],
  link: []
}

/** The fields of an item an approver may rewrite, with what it would write now. */
export const adjustableValues = (input: ItemInput): Record<string, string> => {
  const source: Record<string, unknown> =
    input.kind === 'create_card' ? input.card : input.kind === 'update_card' ? input.changes : { ...input }
  return Object.fromEntries(
    ADJUSTABLE[input.kind]
      .filter((field) => typeof source[field] === 'string')
      .map((field) => [field, source[field] as string])
  )
}

/**
 * The item with an approver's text in place of the agent's.
 *
 * @example adjusted({ kind: 'comment', cardId: 'c', body: 'Oi' }, { body: 'Olá' })   // { kind: 'comment', cardId: 'c', body: 'Olá' }
 */
export const adjusted = (input: ItemInput, values: Record<string, string>): ItemInput => {
  if (input.kind === 'create_card') {
    return { ...input, card: { ...input.card, ...values } }
  }
  if (input.kind === 'update_card') {
    return { ...input, changes: { ...input.changes, ...values } }
  }
  return input.kind === 'comment' ? { ...input, ...values } : input
}

/** "há 3 dias" from now: the age of a proposal, in whole units. */
export const age = (iso: string, now: Date): string => {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) {
    return minutes <= 1 ? 'agora' : `há ${minutes} min`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `há ${hours} h`
  }
  const days = Math.round(hours / 24)
  return days === 1 ? 'há 1 dia' : `há ${days} dias`
}
