/** Card vocabulary, in the words the areas use in Jira. */
export const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABEL: Record<Priority, string> = {
  highest: 'Altíssima',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
  lowest: 'Baixíssima'
}

export const PRIORITY_ICON = {
  highest: 'chevronsUp',
  high: 'chevronUp',
  medium: 'equal',
  low: 'chevronDown',
  lowest: 'chevronsDown'
} as const

export const STATE_GROUPS = ['not_started', 'in_progress', 'done', 'cancelled'] as const
export type StateGroup = (typeof STATE_GROUPS)[number]

export const STATE_GROUP_LABEL: Record<StateGroup, string> = {
  not_started: 'Não iniciado',
  in_progress: 'Em andamento',
  done: 'Concluído',
  cancelled: 'Cancelado'
}

/** The estimate scale Tecnologia uses in refinement (fluxo-jira.md: P/M/G). */
export const ESTIMATES = ['P', 'M', 'G'] as const

/** Initials for an avatar: "Ana Souza" → "AS". */
export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => /^[\p{L}]/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')

/**
 * Where a dragged card lands: the index among the column's other cards, from the pointer's height.
 * Each card counts as "above the pointer" when its middle is above it.
 *
 * @example dropIndex([{ top: 0, height: 40 }, { top: 48, height: 40 }], 30)   // 1
 */
export const dropIndex = (cards: readonly { top: number; height: number }[], pointerY: number): number =>
  cards.filter((card) => card.top + card.height / 2 < pointerY).length

/** Labels typed as "a, b , c" → ["a", "b", "c"], without blanks or repeats. */
export const parseLabels = (text: string): string[] => [
  ...new Set(
    text
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean)
  )
]

/**
 * A label's colour from the space's catalogue (ADR-0032); grey for a name it does not know yet — one a
 * card just got, before the catalogue is read again.
 *
 * @example labelColor([{ name: 'okr', color: 'teal' }], 'okr')   // 'teal'
 */
export const labelColor = <Color extends string>(
  labels: readonly { name: string; color: Color }[],
  name: string
): Color | 'gray' => labels.find((label) => label.name === name)?.color ?? 'gray'
