import type { Editor } from '@tiptap/core'

import { type Html, html } from '@/lib/html'
import { openFormDialog, textField } from '@/ui/dialog'
import { type IconName, icon } from '@/ui/icons'

/**
 * The bar over a page being edited (escopo-mvp 5.2): the kind of block, the marks on the text, its colour,
 * alignment, lists and the blocks Confluence has on its own bar. Each button shows whether it is on where
 * the cursor is; the bar hides while the page cannot be edited.
 */
type Tool = {
  name: string
  label: string
  icon: IconName
  run: (editor: Editor) => void
  active?: (editor: Editor) => boolean
}

const mark = (name: string, label: string, toolIcon: IconName, toggle: (editor: Editor) => void): Tool => ({
  name,
  label,
  icon: toolIcon,
  run: toggle,
  active: (editor) => editor.isActive(name)
})

const align = (side: 'left' | 'center' | 'right', label: string, toolIcon: IconName): Tool => ({
  name: `align-${side}`,
  label,
  icon: toolIcon,
  run: (editor) => editor.chain().focus().setTextAlign(side).run(),
  active: (editor) => editor.isActive({ textAlign: side })
})

const MARKS: readonly Tool[] = [
  mark('bold', 'Negrito (⌘B)', 'bold', (editor) => editor.chain().focus().toggleBold().run()),
  mark('italic', 'Itálico (⌘I)', 'italic', (editor) => editor.chain().focus().toggleItalic().run()),
  mark('underline', 'Sublinhado (⌘U)', 'underline', (editor) => editor.chain().focus().toggleUnderline().run()),
  mark('strike', 'Tachado', 'strikethrough', (editor) => editor.chain().focus().toggleStrike().run()),
  mark('code', 'Código', 'code', (editor) => editor.chain().focus().toggleCode().run())
]

const ALIGN: readonly Tool[] = [
  align('left', 'Alinhar à esquerda', 'alignLeft'),
  align('center', 'Centralizar', 'alignCenter'),
  align('right', 'Alinhar à direita', 'alignRight')
]

const BLOCKS: readonly Tool[] = [
  mark('bulletList', 'Lista', 'list', (editor) => editor.chain().focus().toggleBulletList().run()),
  mark('orderedList', 'Lista numerada', 'listNumbers', (editor) => editor.chain().focus().toggleOrderedList().run()),
  mark('taskList', 'Lista de tarefas', 'listCheck', (editor) => editor.chain().focus().toggleTaskList().run()),
  mark('blockquote', 'Citação', 'blockquote', (editor) => editor.chain().focus().toggleBlockquote().run()),
  mark('callout', 'Destaque', 'infoCircle', (editor) => editor.chain().focus().toggleWrap('callout').run()),
  mark('codeBlock', 'Bloco de código', 'sourceCode', (editor) => editor.chain().focus().toggleCodeBlock().run())
]

const INSERT: readonly Tool[] = [
  {
    name: 'table',
    label: 'Tabela',
    icon: 'table',
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  },
  {
    name: 'clear',
    label: 'Limpar formatação',
    icon: 'clearFormatting',
    run: (editor) => editor.chain().focus().unsetAllMarks().clearNodes().run()
  }
]

/** Text colours and highlights that read on the light and the dark theme alike. */
export const TEXT_COLORS = ['#868e96', '#e03131', '#e8590c', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c']
export const HIGHLIGHTS = [
  'rgba(250, 176, 5, 0.35)',
  'rgba(64, 192, 87, 0.3)',
  'rgba(34, 139, 230, 0.3)',
  'rgba(190, 75, 219, 0.3)',
  'rgba(250, 82, 82, 0.3)'
]

const BLOCK_TYPES = [
  { value: 'paragraph', label: 'Texto normal' },
  { value: '1', label: 'Título 1' },
  { value: '2', label: 'Título 2' },
  { value: '3', label: 'Título 3' }
]

const button = (tool: Tool): Html =>
  html`<button type="button" class="button button-ghost button-icon" data-tool="${tool.name}" aria-label="${tool.label}" title="${tool.label}">${icon(tool.icon, 16)}</button>`

const group = (tools: readonly Tool[]): Html => html`<div class="format-group">${tools.map(button)}</div>`

const swatches = (kind: 'color' | 'highlight', colors: readonly string[]): Html => html`
  <div class="format-swatches">
    <button type="button" class="format-swatch is-none" data-${kind}="" title="Padrão" aria-label="Padrão"></button>
    ${colors.map((color) => html`<button type="button" class="format-swatch" data-${kind}="${color}" style="--swatch: ${color}" title="${color}" aria-label="${color}"></button>`)}
  </div>
`

const palette = (): Html => html`
  <div class="format-palette glass" data-palette hidden>
    <p class="format-palette-title">Cor do texto</p>${swatches('color', TEXT_COLORS)}
    <p class="format-palette-title">Realce</p>${swatches('highlight', HIGHLIGHTS)}
  </div>
`

const markup = (): Html => html`
  <div class="format-group">
    <label class="sr-only" for="format-block">Tipo de bloco</label>
    <select id="format-block" class="input format-block" data-block>${BLOCK_TYPES.map((type) => html`<option value="${type.value}">${type.label}</option>`)}</select>
  </div>
  ${group(MARKS)}
  <div class="format-group format-color">
    <button type="button" class="button button-ghost button-icon" data-tool="palette" aria-label="Cor e realce" title="Cor e realce" aria-haspopup="true">${icon('textColor', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-tool="link" aria-label="Link (⌘K)" title="Link (⌘K)">${icon('link', 16)}</button>
    ${palette()}
  </div>
  ${group(ALIGN)}${group(BLOCKS)}${group(INSERT)}
`

const TOOLS = new Map([...MARKS, ...ALIGN, ...BLOCKS, ...INSERT].map((tool) => [tool.name, tool]))

/** Asks for the address; an empty one takes the link off. */
export const editLink = (editor: Editor): void => {
  const current = String(editor.getAttributes('link').href ?? '')
  openFormDialog({
    title: current ? 'Editar link' : 'Inserir link',
    submit: 'Aplicar',
    done: 'Link aplicado.',
    fields: textField({ name: 'href', label: 'Endereço', type: 'url', value: current, placeholder: 'https://' }),
    onSubmit: async (data) => {
      const href = String(data.get('href')).trim()
      const chain = editor.chain().focus().extendMarkRange('link')
      ;(href ? chain.setLink({ href }) : chain.unsetLink()).run()
    }
  })
}

const blockOf = (editor: Editor): string => {
  const level = [1, 2, 3].find((each) => editor.isActive('heading', { level: each }))
  return level ? String(level) : 'paragraph'
}

const setBlock = (editor: Editor, value: string): void => {
  const chain = editor.chain().focus()
  ;(value === 'paragraph' ? chain.setParagraph() : chain.setHeading({ level: Number(value) as 1 | 2 | 3 })).run()
}

const refresh = (bar: HTMLElement, editor: Editor): void => {
  bar.hidden = !editor.isEditable
  for (const button of bar.querySelectorAll<HTMLElement>('[data-tool]')) {
    const on = TOOLS.get(button.dataset.tool ?? '')?.active?.(editor) ?? false
    button.classList.toggle('is-on', on)
  }
  const select = bar.querySelector<HTMLSelectElement>('[data-block]')
  if (select && document.activeElement !== select) {
    select.value = blockOf(editor)
  }
}

const applyColor = (editor: Editor, target: HTMLElement): void => {
  const { color, highlight } = target.dataset
  if (color !== undefined) {
    const chain = editor.chain().focus()
    ;(color ? chain.setColor(color) : chain.unsetColor()).run()
  } else if (highlight !== undefined) {
    const chain = editor.chain().focus()
    ;(highlight ? chain.setHighlight({ color: highlight }) : chain.unsetHighlight()).run()
  }
}

const onClick = (bar: HTMLElement, editor: Editor, event: MouseEvent): void => {
  const target = event.target as HTMLElement
  const paletteBox = bar.querySelector<HTMLElement>('[data-palette]')
  const swatch = target.closest<HTMLElement>('.format-swatch')
  const name = target.closest<HTMLElement>('[data-tool]')?.dataset.tool
  if (swatch && paletteBox) {
    applyColor(editor, swatch)
    paletteBox.hidden = true
  } else if (name === 'palette' && paletteBox) {
    paletteBox.hidden = !paletteBox.hidden
  } else if (name === 'link') {
    editLink(editor)
  } else if (name) {
    TOOLS.get(name)?.run(editor)
  }
}

/** The bar for one editor; it follows the editor's selection and goes with it. */
export const formatToolbar = (editor: Editor): HTMLElement => {
  const bar = document.createElement('div')
  bar.className = 'format-toolbar'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Formatação')
  bar.innerHTML = markup().value
  bar.addEventListener('mousedown', (event) => {
    if (!(event.target as HTMLElement).closest('select')) {
      event.preventDefault()
    }
  })
  bar.addEventListener('click', (event) => onClick(bar, editor, event))
  bar.querySelector<HTMLSelectElement>('[data-block]')?.addEventListener('change', (event) => {
    setBlock(editor, (event.target as HTMLSelectElement).value)
  })
  const update = () => refresh(bar, editor)
  editor.on('transaction', update)
  editor.on('update', update)
  update()
  return bar
}
