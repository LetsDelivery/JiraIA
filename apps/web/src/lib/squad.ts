/** How many tones the palette has: `--squad-1` … `--squad-6` in tokens.css. */
export const SQUAD_TONES = 6

/**
 * The tone a squad's chip wears: picked from its id, so a group keeps its colour on every screen and
 * every machine without storing one. Colour here names the team, as a label would.
 *
 * @example squadTone('0b6f1c2e-…')   // 1…6, always the same for that id
 */
export const squadTone = (groupId: string): number => {
  let sum = 0
  for (const char of groupId) {
    sum = (sum * 31 + char.charCodeAt(0)) % 9973
  }
  return (sum % SQUAD_TONES) + 1
}
