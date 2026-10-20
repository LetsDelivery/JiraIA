/**
 * How a link reads from the card on screen (escopo-mvp 2.7): the API stores it once, from the card that
 * does it; the screen says "bloqueia" on one end and "é bloqueado por" on the other.
 */
export const LINK_TYPES = ['relates', 'blocks', 'duplicates', 'delivers', 'causes'] as const
export type LinkType = (typeof LINK_TYPES)[number]
export type Direction = 'outward' | 'inward'

export const LINK_LABEL: Record<LinkType, Record<Direction, string>> = {
  relates: { outward: 'relaciona-se com', inward: 'relaciona-se com' },
  blocks: { outward: 'bloqueia', inward: 'é bloqueado por' },
  duplicates: { outward: 'duplica', inward: 'é duplicado por' },
  delivers: { outward: 'entrega', inward: 'é entregue por' },
  causes: { outward: 'causa (incidente)', inward: 'é causado por (incidente)' }
}

/** Every way a link can read, as one choice: `blocks:inward` is "é bloqueado por". */
export const LINK_CHOICES = LINK_TYPES.flatMap((type) =>
  (type === 'relates' ? (['outward'] as const) : (['outward', 'inward'] as const)).map((direction) => ({
    value: `${type}:${direction}`,
    label: LINK_LABEL[type][direction]
  }))
)

export const parseLinkChoice = (value: string): { type: LinkType; direction: Direction } => {
  const [type, direction] = value.split(':')
  return {
    type: LINK_TYPES.includes(type as LinkType) ? (type as LinkType) : 'relates',
    direction: direction === 'inward' ? 'inward' : 'outward'
  }
}

/**
 * A comment body as pieces to draw: text, and mentions written `<@memberId>`.
 *
 * @example mentionParts('oi <@id-1>!')   // [{ text: 'oi ' }, { memberId: 'id-1' }, { text: '!' }]
 */
export type MentionPart = { text: string } | { memberId: string }

export const mentionParts = (body: string): MentionPart[] =>
  body
    .split(/(<@[0-9a-fA-F-]{36}>)/)
    .filter(Boolean)
    .map((piece) =>
      /^<@[0-9a-fA-F-]{36}>$/.test(piece) ? { memberId: piece.slice(2, -1).toLowerCase() } : { text: piece }
    )

/**
 * The word being typed after an `@`, when the caret is right after it — what the mention menu filters
 * by. `undefined` when the caret is not in a mention.
 *
 * @example mentionQuery('fala @an', 8)   // { query: 'an', start: 5 }
 */
export const mentionQuery = (text: string, caret: number): { query: string; start: number } | undefined => {
  const match = /(^|\s)@([\p{L}\p{N}._-]*)$/u.exec(text.slice(0, caret))
  return match ? { query: match[2] ?? '', start: caret - (match[2]?.length ?? 0) - 1 } : undefined
}

/** Readable sizes: 812 B, 14 KB, 3,2 MB. */
export const fileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`
}

/**
 * A comment as typed — `@Ana Souza` — into the body the API keeps, `<@id>`, for every member named.
 * Longer names first, so "@Ana Souza" is never read as "@Ana" followed by text.
 *
 * @example toTokens('oi @Ana Souza', [{ id: 'a1', name: 'Ana Souza' }])   // 'oi <@a1>'
 */
export const toTokens = (text: string, members: readonly { id: string; name: string }[]): string =>
  [...members]
    .sort((a, b) => b.name.length - a.name.length)
    .reduce((body, member) => body.split(`@${member.name}`).join(`<@${member.id}>`), text)

/** The body back as people type it, for editing: each `<@id>` as `@Name`. */
export const fromTokens = (body: string, names: ReadonlyMap<string, string>): string =>
  mentionParts(body)
    .map((part) => ('text' in part ? part.text : `@${names.get(part.memberId) ?? 'alguém'}`))
    .join('')
