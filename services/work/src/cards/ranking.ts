/**
 * Where a card goes between its new neighbours: the midpoint of their ranks.
 *
 * One row is written per move. When two neighbours are so close that the midpoint would equal one of
 * them, the answer is `undefined` and the caller renumbers the column first.
 *
 * @example rankAt([1, 2, 3], 1)   // 1.5 — between the first and the second
 * @example rankAt([], 0)          // 1
 */
export const rankAt = (ranks: readonly number[], index: number): number | undefined => {
  const at = Math.max(0, Math.min(index, ranks.length))
  const before = ranks[at - 1]
  const after = ranks[at]

  if (before === undefined && after === undefined) {
    return 1
  }
  if (before === undefined) {
    return (after as number) - 1
  }
  if (after === undefined) {
    return before + 1
  }

  const middle = (before + after) / 2
  return middle > before && middle < after ? middle : undefined
}
