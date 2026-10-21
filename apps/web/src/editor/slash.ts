import { type Editor, Extension, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'

import { icon } from '@/ui/icons'

import { type MenuItem, suggestionMenu } from './suggestion-menu'

/** What a slash command needs from the page around the editor: files and a card to embed. */
export type SlashContext = {
  /** Asks for a file and puts it in the page as an image or a file block. */
  insertFile: (editor: Editor, kind: 'image' | 'file') => void
  /** Asks which card and embeds it. */
  insertCard: (editor: Editor) => void
  /** Asks which whiteboard and shows it in the page. */
  insertBoard: (editor: Editor) => void
}

type Command = MenuItem & { keywords: string; run: (editor: Editor, context: SlashContext) => void }

const COMMANDS: readonly Command[] = [
  { label: 'Texto', keywords: 'paragrafo texto', run: (editor) => editor.chain().focus().setParagraph().run() },
  {
    label: 'Título 1',
    hint: '#',
    keywords: 'titulo h1',
    run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run()
  },
  {
    label: 'Título 2',
    hint: '##',
    keywords: 'titulo h2',
    run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run()
  },
  {
    label: 'Título 3',
    hint: '###',
    keywords: 'titulo h3',
    run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run()
  },
  {
    label: 'Lista',
    hint: '-',
    keywords: 'lista marcadores',
    run: (editor) => editor.chain().focus().toggleBulletList().run()
  },
  {
    label: 'Lista numerada',
    hint: '1.',
    keywords: 'lista numerada ordenada',
    run: (editor) => editor.chain().focus().toggleOrderedList().run()
  },
  {
    label: 'Lista de tarefas',
    hint: '[ ]',
    keywords: 'tarefas checklist todo',
    run: (editor) => editor.chain().focus().toggleTaskList().run()
  },
  {
    label: 'Citação',
    hint: '>',
    keywords: 'citacao quote',
    run: (editor) => editor.chain().focus().toggleBlockquote().run()
  },
  {
    label: 'Destaque',
    keywords: 'destaque painel callout aviso',
    run: (editor) => editor.chain().focus().wrapIn('callout').run()
  },
  {
    label: 'Código',
    hint: '```',
    keywords: 'codigo code',
    run: (editor) => editor.chain().focus().toggleCodeBlock().run()
  },
  {
    label: 'Tabela',
    keywords: 'tabela table',
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  },
  {
    label: 'Divisor',
    hint: '---',
    keywords: 'divisor linha hr',
    run: (editor) => editor.chain().focus().setHorizontalRule().run()
  },
  { label: 'Imagem', keywords: 'imagem foto image', run: (editor, context) => context.insertFile(editor, 'image') },
  { label: 'Anexo', keywords: 'anexo arquivo file', run: (editor, context) => context.insertFile(editor, 'file') },
  {
    label: 'Card',
    hint: 'embutido',
    keywords: 'card embutir jira',
    run: (editor, context) => context.insertCard(editor)
  },
  {
    label: 'Quadro',
    hint: 'whiteboard',
    keywords: 'quadro whiteboard desenho diagrama board',
    run: (editor, context) => context.insertBoard(editor)
  }
]

const _normal = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** The commands that match what was typed after `/`, by name or keyword, accents ignored. */
export const slashItems = (query: string): Command[] => {
  const wanted = _normal(query)
  return COMMANDS.filter((command) => _normal(`${command.label} ${command.keywords}`).includes(wanted))
}

/** `/` at the start of a word opens the block menu (escopo-mvp 5.2). */
export const SlashCommand = Extension.create<SlashContext>({
  name: 'slashCommand',
  addOptions: () => ({ insertFile: () => undefined, insertCard: () => undefined, insertBoard: () => undefined }),
  addProseMirrorPlugins() {
    const context = this.options
    return [
      Suggestion<Command>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        startOfLine: false,
        items: ({ query }) => slashItems(query).map((command) => ({ ...command, icon: icon('plus', 14) })),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: Command }) => {
          editor.chain().focus().deleteRange(range).run()
          props.run(editor, context)
        },
        render: () => suggestionMenu<Command>('Blocos')
      })
    ]
  }
})
