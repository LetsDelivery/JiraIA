/**
 * Let’s Draw AI's addresses (ADR-0010, ADR-0011): everything lives under `/draw`, apart from JiraIA's
 * cards. A Draw space is its own — not a JiraIA space — and is addressed by its id.
 *
 * @example contentPath('s1', 'c1')   // '/draw/s1/c1'
 */
export const DRAW_HOME = '/draw'

export const drawSpacePath = (spaceId: string): string => `${DRAW_HOME}/${spaceId}`

export const contentPath = (spaceId: string, contentId: string): string => `${drawSpacePath(spaceId)}/${contentId}`

/** What each kind of content is called, and the icon the tree shows it with. */
export const KIND_LABEL = { folder: 'Pasta', page: 'Página', whiteboard: 'Quadro branco' } as const
export type Kind = keyof typeof KIND_LABEL
