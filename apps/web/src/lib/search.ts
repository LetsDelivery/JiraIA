/**
 * What the search box understands (escopo-mvp 3.6): a key such as `PRD-219` goes straight to the card;
 * anything else is text to search for.
 */
const CARD_KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/

/**
 * The key as the API writes it, or nothing when the text is not one.
 *
 * @example cardKey(' prd-219 ')   // 'PRD-219'
 */
export const cardKey = (text: string): string | undefined => {
  const match = CARD_KEY.exec(text.trim())
  return match ? `${(match[1] ?? '').toUpperCase()}-${match[2]}` : undefined
}

/**
 * The card a pasted text points at: a key, or a JiraIA address that opens one (`…?card=PRD-219`).
 *
 * @example cardKeyIn('http://localhost:5280/espacos/PRD?card=prd-219')   // 'PRD-219'
 */
export const cardKeyIn = (text: string): string | undefined => {
  const typed = cardKey(text)
  if (typed) {
    return typed
  }
  try {
    return cardKey(new URL(text.trim()).searchParams.get('card') ?? '')
  } catch {
    return undefined
  }
}

/** `PRD` from `PRD-219`. */
export const spaceKeyOf = (key: string): string => key.split('-')[0] ?? ''

/** Where the text was found, as a result line says it. */
export const MATCH_LABEL: Record<'key' | 'title' | 'description' | 'comment', string> = {
  key: 'pela chave',
  title: 'no título',
  description: 'na descrição',
  comment: 'num comentário'
}

/**
 * The cards whose key or title holds the text, those whose key starts with it first — what a box
 * suggests from cards already on screen, as one types.
 *
 * @example cardsMatching(cards, 'prd-2')   // PRD-2, PRD-21, … before a card titled "Ver prd-2"
 */
export const cardsMatching = <T extends { key: string; title: string }>(cards: readonly T[], text: string): T[] => {
  const query = text.trim().toLowerCase()
  const found = cards.filter((card) => `${card.key} ${card.title}`.toLowerCase().includes(query))
  const byKey = (card: T): number => (card.key.toLowerCase().startsWith(query) ? 0 : 1)
  return query ? found.sort((a, b) => byKey(a) - byKey(b)) : []
}
