/**
 * Two versions of a page compared line by line (escopo-mvp 5.4): the longest common subsequence,
 * then what was taken out and what was put in.
 */
export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string }

const _cell = (table: number[][], same: boolean, i: number, j: number): number =>
  same ? (table[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0)

/** `table[i][j]`: the longest common run of `before` from `i` and `after` from `j`. */
const _table = (before: readonly string[], after: readonly string[]): number[][] => {
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      ;(table[i] as number[])[j] = _cell(table, before[i] === after[j], i, j)
    }
  }
  return table
}

/**
 * @example diffLines('a\nb', 'a\nc')   // same a, removed b, added c
 */
export const diffLines = (beforeText: string, afterText: string): DiffLine[] => {
  const before = beforeText.split('\n')
  const after = afterText.split('\n')
  const table = _table(before, after)
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    const step = _step(table, before, after, i, j)
    lines.push(step.line)
    i += step.di
    j += step.dj
  }
  return lines
}

const _addedNext = (table: number[][], i: number, j: number, before: number, after: number): boolean =>
  j < after && (i >= before || (table[i]?.[j + 1] ?? 0) >= (table[i + 1]?.[j] ?? 0))

const _step = (table: number[][], before: readonly string[], after: readonly string[], i: number, j: number) => {
  if (i < before.length && j < after.length && before[i] === after[j]) {
    return { line: { kind: 'same' as const, text: before[i] ?? '' }, di: 1, dj: 1 }
  }
  if (_addedNext(table, i, j, before.length, after.length)) {
    return { line: { kind: 'added' as const, text: after[j] ?? '' }, di: 0, dj: 1 }
  }
  return { line: { kind: 'removed' as const, text: before[i] ?? '' }, di: 1, dj: 0 }
}

/** How much changed, as a version list says it: "+3 −1". */
export const diffSummary = (lines: readonly DiffLine[]): { added: number; removed: number } => ({
  added: lines.filter((line) => line.kind === 'added').length,
  removed: lines.filter((line) => line.kind === 'removed').length
})
