/**
 * The cards a Slack message points at (Etapa 5e): a JiraIA address that opens one (`…?card=PRD-219`),
 * or a key written on its own (`PRD-219`). Keys are matched as written and read upper case.
 */
const KEY = /\b([A-Za-z][A-Za-z0-9]{1,9}-\d{1,7})\b/g

/** The key a JiraIA address opens, if it opens one, and only on JiraIA's own host. */
export const keyInUrl = (url: string, webUrl: string): string | undefined => {
  try {
    const address = new URL(url)
    const card = address.searchParams.get('card')
    return address.host === new URL(webUrl).host && card && /^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/.test(card)
      ? card.toUpperCase()
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The keys written in a message, outside links, without repeats, at most `limit`.
 *
 * @example keysInText('Veja PRD-219 e prd-219, e <https://x/?card=TEC-1|TEC-1>', 3)   // ['PRD-219']
 */
export const keysInText = (text: string, limit: number): string[] => {
  const outsideLinks = text.replace(/<[^>]*>/g, ' ')
  const keys = [...outsideLinks.matchAll(KEY)].map((match) => (match[1] ?? '').toUpperCase())
  return [...new Set(keys)].slice(0, limit)
}
