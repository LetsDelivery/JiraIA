import type { MemberRepository } from '../members/member.repository.js'

/** A mention is written `<@memberId>`; a notice shows the name. */
const MENTION = /<@([0-9a-f-]{36})>/g

/** The first 140 characters of a comment, with mentions as names. */
export const excerpt = async (members: MemberRepository, organizationId: string, body: string): Promise<string> => {
  const names = new Map((await members.list(organizationId)).map((member) => [member.id, member.name]))
  const text = body
    .replace(MENTION, (_, id: string) => `@${names.get(id) ?? 'alguém'}`)
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 140 ? `${text.slice(0, 139)}…` : text
}
