import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { copyPng, download, type ExportOptions, exportPng, exportSvg, fileName } from '@/whiteboard/export'
import { importScene, sceneJson } from '@/whiteboard/scene-file'
import type { Whiteboard } from '@/whiteboard/whiteboard'

import { closeOnEscape, openFormDialog, textField } from './dialog'
import { icon } from './icons'
import { toast } from './toast'

/**
 * The whiteboard's files (Etapa 4d-c, ADR-0017): export as PNG, SVG or JSON, copy as an image, open a
 * `.json` or `.excalidraw` file into the board, and save a named version. The board itself saves on
 * every change; a version is a point to come back to.
 */
const options: ExportOptions = { onlySelected: false, transparent: false }

const toggles = (board: Whiteboard): Html => html`
  <div class="chips" role="group" aria-label="O que exportar">
    <button type="button" class="chip chip-toggle" data-export-toggle="onlySelected" aria-pressed="${options.onlySelected && board.selection.length > 0}" ${board.selection.length ? '' : html`disabled`}>Somente a seleção</button>
    <button type="button" class="chip chip-toggle" data-export-toggle="transparent" aria-pressed="${options.transparent}">Fundo transparente</button>
  </div>`

const ACTIONS: Record<string, (board: Whiteboard, title: string) => Promise<unknown>> = {
  png: async (board, title) => download(await exportPng(board, options), fileName(title, 'png')),
  svg: async (board, title) =>
    download(new Blob([(await exportSvg(board, options)).svg], { type: 'image/svg+xml' }), fileName(title, 'svg')),
  copy: async (board) => {
    await copyPng(board, options)
    toast('Imagem copiada.')
  },
  json: async (board, title) => download(sceneJson(board), fileName(title, 'json'))
}

export const openExport = (board: Whiteboard, title: string): void => {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog glass wb-export-dialog'
  dialog.setAttribute('aria-label', 'Exportar quadro')
  const draw = () => {
    dialog.innerHTML = html`
      <header class="dialog-header"><h2>Exportar quadro</h2>
        <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button></header>
      <div class="dialog-body">
        ${toggles(board)}
        <div class="wb-export-actions">
          <button type="button" class="button button-primary" data-export="png">${icon('download', 16)}Baixar PNG</button>
          <button type="button" class="button button-secondary" data-export="svg">${icon('download', 16)}Baixar SVG</button>
          <button type="button" class="button button-secondary" data-export="copy">${icon('copy', 16)}Copiar imagem</button>
          <button type="button" class="button button-ghost" data-export="json">${icon('download', 16)}Baixar .json</button>
        </div>
        <p class="field-hint">O .json abre de novo em qualquer quadro, pelo botão de abrir arquivo.</p>
      </div>`.value
  }
  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const toggle = target.closest<HTMLElement>('[data-export-toggle]')?.dataset.exportToggle as
      | keyof ExportOptions
      | undefined
    const action = target.closest<HTMLElement>('[data-export]')?.dataset.export
    if (target.closest('[data-close]')) {
      dialog.remove()
    } else if (toggle) {
      options[toggle] = !options[toggle]
      draw()
    } else if (action) {
      void ACTIONS[action]?.(board, title).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    }
  })
  closeOnEscape(dialog, () => dialog.remove())
  draw()
  document.body.append(dialog)
  dialog.showModal()
}

/** A `.json` of ours or an `.excalidraw` file, added to the board. */
export const openImport = (board: Whiteboard): void => {
  const input = Object.assign(document.createElement('input'), {
    type: 'file',
    accept: '.json,.excalidraw,application/json'
  })
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (!file) {
      return
    }
    importScene(board, file)
      .then((count) => toast(count === 1 ? '1 elemento adicionado.' : `${count} elementos adicionados.`))
      .catch((refusal: unknown) =>
        toast(refusal instanceof SyntaxError ? 'Este arquivo não é um quadro.' : refusalSentence(refusal), 'error')
      )
  })
  input.click()
}

/** A version of the board as it is now, named — to come back to it from Versões. */
export const openSaveVersion = (save: (name?: string) => Promise<unknown>): void =>
  openFormDialog({
    title: 'Salvar versão',
    submit: 'Salvar versão',
    done: 'Versão salva. Ela aparece em Versões.',
    fields: textField({
      name: 'name',
      label: 'Nome (opcional)',
      placeholder: 'Antes da revisão com o time',
      maxLength: 120
    }),
    onSubmit: (data) => save(String(data.get('name') ?? '').trim() || undefined)
  })
