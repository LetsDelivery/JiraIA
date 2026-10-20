/** What a template's blanks can name: `card`, `created`, `linked`, each a flat record of text. */
export type TemplateValues = Record<string, Record<string, string> | undefined>

const BLANK = /\{\{\s*([a-z]+)\.([a-zA-Z]+)\s*\}\}/g

/**
 * Fills `{{card.key}}`-style blanks. A blank that names nothing known becomes empty rather than
 * staying as braces in a comment or a Slack message.
 *
 * @example fill('{{card.key}} priorizado', { card: { key: 'REQ-12' } })   // 'REQ-12 priorizado'
 */
export const fill = (template: string, values: TemplateValues): string =>
  template.replace(BLANK, (_, scope: string, field: string) => values[scope]?.[field] ?? '')
