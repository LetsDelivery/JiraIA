/**
 * Atlassian's document format (ADF) — Jira descriptions and comments, Confluence bodies — written as
 * the GitHub-flavoured Markdown a card description holds (ADR-0030). What Markdown cannot carry keeps
 * its words: a panel becomes a quote, a status its text, an expand its title over its content.
 *
 * Mentions are resolved by the caller (`mention`): a member becomes `<@memberId>`, as the panel writes
 * one; anyone else keeps the `@Name` Atlassian stored.
 */
export type AdfNode = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: AdfNode[]
}

export type AdfOptions = {
  /** `<@memberId>` for a member; `undefined` keeps Atlassian's own `@Name`. */
  mention: (accountId: string) => string | undefined
}

type Block = (node: AdfNode, options: AdfOptions, depth: number) => string

const str = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value))

/** Characters that would change Markdown's meaning, escaped in running text. */
const escapeText = (text: string): string => text.replace(/([\\`*_[\]<>~])/g, '\\$1')

const MARKS: Record<string, (text: string, attrs: Record<string, unknown>) => string> = {
  strong: (text) => `**${text}**`,
  em: (text) => `*${text}*`,
  strike: (text) => `~~${text}~~`,
  link: (text, attrs) => `[${text}](${str(attrs.href)})`
}

const markedText = (node: AdfNode): string => {
  const marks = node.marks ?? []
  if (marks.some((mark) => mark.type === 'code')) {
    return `\`${str(node.text).replaceAll('`', 'ˋ')}\``
  }
  return marks.reduce((text, mark) => MARKS[mark.type]?.(text, mark.attrs ?? {}) ?? text, escapeText(str(node.text)))
}

const formatDate = (timestamp: unknown): string => {
  const millis = Number(timestamp)
  return Number.isFinite(millis) ? new Date(millis).toISOString().slice(0, 10) : ''
}

const INLINE: Record<string, (node: AdfNode, options: AdfOptions) => string> = {
  text: (node) => markedText(node),
  hardBreak: () => '  \n',
  mention: (node, options) => options.mention(str(node.attrs?.id)) ?? escapeText(str(node.attrs?.text) || '@?'),
  emoji: (node) => str(node.attrs?.text) || str(node.attrs?.shortName),
  date: (node) => formatDate(node.attrs?.timestamp),
  status: (node) => `\`${str(node.attrs?.text)}\``,
  inlineCard: (node) => `<${str(node.attrs?.url)}>`,
  placeholder: () => '',
  mediaInline: (node) => `📎 ${escapeText(str(node.attrs?.alt) || 'anexo')}`
}

/** The text of a node's inline children, on one line. */
export const inline = (nodes: AdfNode[] | undefined, options: AdfOptions): string =>
  (nodes ?? [])
    .map((node) => (INLINE[node.type] ?? ((child) => inline(child.content, options)))(node, options))
    .join('')

const blocks = (nodes: AdfNode[] | undefined, options: AdfOptions, depth = 0): string =>
  (nodes ?? [])
    .map((node) => renderBlock(node, options, depth))
    .filter((text) => text !== '')
    .join('\n\n')

const indent = (text: string, by: string): string => text.replace(/\n(?=[^\n])/g, `\n${by}`)

const listItems = (node: AdfNode, options: AdfOptions, depth: number, marker: (index: number) => string): string =>
  (node.content ?? [])
    .map((item, index) => {
      const prefix = marker(index)
      return `${prefix}${indent(blocks(item.content, options, depth + 1), ' '.repeat(prefix.length))}`
    })
    .join('\n')

const taskItems = (node: AdfNode, options: AdfOptions): string =>
  (node.content ?? [])
    .map((item) => `- [${item.attrs?.state === 'DONE' ? 'x' : ' '}] ${inline(item.content, options)}`)
    .join('\n')

const cell = (node: AdfNode, options: AdfOptions): string =>
  blocks(node.content, options).replaceAll('\n\n', '<br>').replaceAll('\n', ' ').replaceAll('|', '\\|')

const table = (node: AdfNode, options: AdfOptions): string => {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((item) => cell(item, options)))
  const width = Math.max(0, ...rows.map((row) => row.length))
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`
  const [header = [], ...body] = rows
  return [line(header), `|${' --- |'.repeat(width)}`, ...body.map(line)].join('\n')
}

const quote = (text: string): string =>
  text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')

const PANEL_LABEL: Record<string, string> = {
  info: 'ℹ️',
  note: '📝',
  warning: '⚠️',
  error: '⛔',
  success: '✅',
  tip: '💡'
}

const BLOCKS: Record<string, Block> = {
  paragraph: (node, options) => inline(node.content, options),
  heading: (node, options) =>
    `${'#'.repeat(Math.min(6, Number(node.attrs?.level) || 1))} ${inline(node.content, options)}`,
  bulletList: (node, options, depth) => listItems(node, options, depth, () => '- '),
  orderedList: (node, options, depth) =>
    listItems(node, options, depth, (index) => `${(Number(node.attrs?.order) || 1) + index}. `),
  taskList: (node, options) => taskItems(node, options),
  decisionList: (node, options) => taskItems(node, options),
  blockquote: (node, options, depth) => quote(blocks(node.content, options, depth)),
  panel: (node, options, depth) =>
    quote(`${PANEL_LABEL[str(node.attrs?.panelType)] ?? '📌'} ${blocks(node.content, options, depth)}`),
  codeBlock: (node) =>
    `\`\`\`${str(node.attrs?.language)}\n${(node.content ?? []).map((t) => str(t.text)).join('')}\n\`\`\``,
  rule: () => '---',
  table: (node, options) => table(node, options),
  expand: (node, options, depth) =>
    `**${escapeText(str(node.attrs?.title))}**\n\n${blocks(node.content, options, depth)}`,
  nestedExpand: (node, options, depth) => BLOCKS.expand?.(node, options, depth) ?? '',
  mediaSingle: (node) => media(node),
  mediaGroup: (node) => media(node),
  blockCard: (node) => `<${str(node.attrs?.url)}>`,
  embedCard: (node) => `<${str(node.attrs?.url)}>`,
  extension: (node) => `\`[${str(node.attrs?.extensionKey) || 'macro'}]\``,
  bodiedExtension: (node, options, depth) => blocks(node.content, options, depth)
}

/** An attachment shown inline; 8c-2 points it at the imported file. */
const media = (node: AdfNode): string =>
  (node.content ?? [])
    .filter((child) => child.type === 'media')
    .map((child) => `📎 ${escapeText(str(child.attrs?.alt) || 'anexo')}`)
    .join('\n')

function renderBlock(node: AdfNode, options: AdfOptions, depth: number): string {
  const render = BLOCKS[node.type]
  return render ? render(node, options, depth) : blocks(node.content, options, depth) || inline([node], options)
}

/** A whole ADF document — or `null`, or plain text from an older Jira — as Markdown. */
export const adfToMarkdown = (document: unknown, options: AdfOptions): string => {
  if (typeof document === 'string') {
    return document
  }
  if (document === null || typeof document !== 'object') {
    return ''
  }
  return blocks((document as AdfNode).content, options).trim()
}
