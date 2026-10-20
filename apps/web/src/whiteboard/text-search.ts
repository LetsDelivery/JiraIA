import { type Element, isText } from './elements'

/**
 * What a board says in words, for search and the version diff (ADR-0009): frame names first, then the
 * texts, top to bottom and left to right, as someone would read the board.
 */
export const boardText = (elements: readonly Element[]): string => {
  const frames = elements.flatMap((element) => (element.type === 'frame' ? [element.name] : []))
  const texts = elements
    .filter(isText)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((text) => text.text)
  return [...frames, ...texts]
    .map((each) => each.trim())
    .filter(Boolean)
    .join('\n')
}
