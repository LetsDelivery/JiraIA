/** The kinds of space, in the words the areas already use in Jira. */
export const SPACE_TYPES = ['software', 'business', 'product_discovery', 'service_desk'] as const
export type SpaceType = (typeof SPACE_TYPES)[number]

export const SPACE_TYPE_LABEL: Record<SpaceType, string> = {
  software: 'Software',
  business: 'Negócios',
  product_discovery: 'Product Discovery',
  service_desk: 'Service Desk'
}

export const SPACE_TYPE_OPTIONS = SPACE_TYPES.map((type) => ({ value: type, label: SPACE_TYPE_LABEL[type] }))

/**
 * A key suggested from a name: the first letters of its words, or the start of a single word.
 *
 * @example suggestKey('Requisições para Produto')   // 'RPP'
 * @example suggestKey('Marketing')                  // 'MAR'
 */
export const suggestKey = (name: string): string => {
  const words = name
    .normalize('NFD')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  const initials = words.length > 1 ? words.map((word) => word[0]).join('') : (words[0] ?? '').slice(0, 3)
  const key = initials.toUpperCase().replace(/^[0-9]+/, '')

  return key.slice(0, 10)
}

/** The address of a space, by its key — the same stable link everywhere it is shown. */
export const spacePath = (key: string): string => `/espacos/${encodeURIComponent(key)}`
