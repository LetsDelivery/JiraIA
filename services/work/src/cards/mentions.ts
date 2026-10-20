/**
 * Mentions in a comment, written in the body as `<@memberId>` — a person or an agent (2.8).
 *
 * The token keeps the body plain text and survives a rename: the screen shows the member's current
 * name, and "where was I mentioned" reads the ids, not the words.
 *
 * @example mentionedIds('Oi <@0b6f…>, revisa?')   // ['0b6f…']
 */
const MENTION = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi

export const mentionedIds = (body: string): string[] => [
  ...new Set([...body.matchAll(MENTION)].map((match) => (match[1] as string).toLowerCase()))
]
