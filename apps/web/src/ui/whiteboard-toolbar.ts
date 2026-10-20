import { type Html, html } from '@/lib/html'
import { redo, undo } from '@/whiteboard/commands'
import { TOOL_KEYS } from '@/whiteboard/keyboard'
import type { Tool, Whiteboard } from '@/whiteboard/whiteboard'

import { type IconName, icon } from './icons'
import { openExport, openImport, openSaveVersion } from './whiteboard-file'

/**
 * The whiteboard's tools (Etapa 4d, ADR-0017), floating over the top of the canvas, and the zoom and
 * history over its bottom corner. Every button says what it does and its key.
 */
const TOOLS: { tool: Tool; label: string; icon: IconName }[] = [
  { tool: 'hand', label: 'Mão: arrastar o quadro', icon: 'handStop' },
  { tool: 'select', label: 'Selecionar e mover', icon: 'pointer' },
  { tool: 'rectangle', label: 'Retângulo', icon: 'square' },
  { tool: 'diamond', label: 'Losango', icon: 'squareRotated' },
  { tool: 'ellipse', label: 'Elipse', icon: 'circle' },
  { tool: 'arrow', label: 'Seta', icon: 'arrowNarrowRight' },
  { tool: 'line', label: 'Linha', icon: 'line' },
  { tool: 'freedraw', label: 'Caneta', icon: 'pencil' },
  { tool: 'text', label: 'Texto', icon: 'typography' },
  { tool: 'image', label: 'Imagem', icon: 'photo' },
  { tool: 'eraser', label: 'Apagador', icon: 'eraser' },
  { tool: 'frame', label: 'Frame', icon: 'frame' }
]

const keysOf = (tool: Tool): string =>
  Object.entries(TOOL_KEYS)
    .filter(([, each]) => each === tool)
    .map(([key]) => key.toUpperCase())
    .join(' ou ')

const toolButton = (board: Whiteboard, { tool, label, icon: name }: (typeof TOOLS)[number]): Html => {
  const usable = board.editable || tool === 'select' || tool === 'hand'
  const keys = keysOf(tool)
  return html`<button type="button" class="wb-tool" data-tool="${tool}" aria-pressed="${board.tool === tool}" aria-label="${label}"
    title="${label}${keys ? ` (${keys})` : ''}" ${usable ? '' : html`disabled`}>${icon(name, 18)}</button>`
}

const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'

export const whiteboardToolbar = (board: Whiteboard): Html => html`
  <div class="wb-toolbar glass" role="toolbar" aria-label="Ferramentas do quadro">
    ${TOOLS.map((each) => toolButton(board, each))}
  </div>
  <div class="wb-files glass" role="toolbar" aria-label="Arquivo">
    <button type="button" class="wb-tool" data-act="save" aria-label="Salvar versão" title="Salvar versão (${MOD} S)" ${board.editable ? '' : html`disabled`}>${icon('deviceFloppy', 18)}</button>
    <button type="button" class="wb-tool" data-act="export" aria-label="Exportar" title="Exportar PNG, SVG ou .json">${icon('download', 18)}</button>
    <button type="button" class="wb-tool" data-act="import" aria-label="Abrir arquivo" title="Abrir um .json ou .excalidraw neste quadro" ${board.editable ? '' : html`disabled`}>${icon('fileUpload', 18)}</button>
  </div>
  <div class="wb-corner glass" role="toolbar" aria-label="Zoom e histórico">
    <button type="button" class="wb-tool" data-act="out" aria-label="Diminuir o zoom" title="Diminuir o zoom (${MOD} −)">${icon('zoomOut', 18)}</button>
    <button type="button" class="wb-zoom data" data-act="reset" aria-label="Zoom em 100%" title="Voltar a 100% (${MOD} 0)">${Math.round(board.zoom * 100)}%</button>
    <button type="button" class="wb-tool" data-act="in" aria-label="Aumentar o zoom" title="Aumentar o zoom (${MOD} +)">${icon('zoomIn', 18)}</button>
    <button type="button" class="wb-tool" data-act="fit" aria-label="Ajustar à tela" title="Ajustar à tela (Shift 1)">${icon('maximize', 18)}</button>
    <button type="button" class="wb-tool" data-act="fit-selection" aria-label="Zoom na seleção" title="Zoom na seleção (Shift 2)" ${board.selection.length ? '' : html`disabled`}>${icon('focusCentered', 18)}</button>
    <button type="button" class="wb-tool" data-act="grid" aria-pressed="${board.grid}" aria-label="Grade" title="Grade e encaixe nela (${MOD} ')">${icon('grid4x4', 18)}</button>
    <span class="wb-divider" aria-hidden="true"></span>
    <button type="button" class="wb-tool" data-act="undo" aria-label="Desfazer" title="Desfazer (${MOD} Z)" ${board.editable ? '' : html`disabled`}>${icon('restore', 18)}</button>
    <button type="button" class="wb-tool" data-act="redo" aria-label="Refazer" title="Refazer (${MOD} Shift Z)" ${board.editable ? '' : html`disabled`}>${icon('redo', 18)}</button>
  </div>
`

/** What the screen around the board knows: its title, and how to save a version of it. */
export type BoardFile = { title: () => string; saveVersion: (name?: string) => Promise<unknown> }

const fileActions = (file: BoardFile): Record<string, (board: Whiteboard) => void> => ({
  save: () => openSaveVersion(file.saveVersion),
  export: (board) => openExport(board, file.title()),
  import: (board) => openImport(board)
})

const ACTIONS: Record<string, (board: Whiteboard) => void> = {
  out: (board) => board.zoomBy(1 / 1.2),
  in: (board) => board.zoomBy(1.2),
  reset: (board) => board.zoomTo(1),
  fit: (board) => board.fit(),
  'fit-selection': (board) => board.fit(board.selected()),
  grid: (board) => board.toggleGrid(),
  undo: (board) => undo(board),
  redo: (board) => redo(board)
}

/** Draws the toolbar again on every change of the board: a tool, the selection, the zoom. */
export const mountWhiteboardToolbar = (host: HTMLElement, board: Whiteboard, file: BoardFile): void => {
  const actions = { ...ACTIONS, ...fileActions(file) }
  board.onSave = () => openSaveVersion(file.saveVersion)
  const draw = () => {
    host.innerHTML = whiteboardToolbar(board).value
  }
  board.subscribe(draw)
  draw()
  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (button?.dataset.tool) {
      board.setTool(button.dataset.tool as Tool)
    } else if (button?.dataset.act) {
      actions[button.dataset.act]?.(board)
    }
    board.focus()
  })
}
