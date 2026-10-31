import type { Attachment } from '@/api/requests'
import { extensionOf, MAX_TEXT_PREVIEW_BYTES, previewKind, typeLabel } from '@/lib/attachments'
import { type Html, html } from '@/lib/html'
import { fileSize } from '@/lib/relations'

import { closeOnEscape } from './dialog'
import { type IconName, icon } from './icons'

const WHEN = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo'
})
const SPREADSHEETS = new Set(['xls', 'xlsx', 'ods', 'csv', 'tsv'])
const ARCHIVES = new Set(['zip', 'rar', '7z', 'tar', 'gz'])
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 }

/** "07 de ago. de 2026, 11:35" — when the file went up, in São Paulo. */
export const uploadedAt = (attachment: Attachment): string => WHEN.format(new Date(attachment.createdAt))

/** The glyph a file without a picture is told apart by. */
export const fileIcon = (attachment: Attachment): IconName => {
  const extension = extensionOf(attachment.name)
  if (SPREADSHEETS.has(extension)) {
    return 'fileSpreadsheet'
  }
  if (ARCHIVES.has(extension)) {
    return 'fileZip'
  }
  const kind = previewKind(attachment.name, attachment.contentType)
  const byKind: Record<typeof kind, IconName> = {
    image: 'photo',
    pdf: 'fileTypePdf',
    video: 'video',
    audio: 'music',
    text: 'fileCode',
    none: 'file'
  }
  return byKind[kind]
}

const unavailable = (attachment: Attachment, why: string): Html => html`
  <div class="viewer-empty">
    ${icon(fileIcon(attachment), 40)}
    <p>${why}</p>
    <a class="button button-primary" href="${attachment.url}" download="${attachment.name}">${icon('download', 16)}Baixar</a>
  </div>
`

const tooBig = (attachment: Attachment): Html =>
  unavailable(attachment, `Arquivo grande demais para pré-visualizar (${fileSize(attachment.size)}).`)

/** The file itself, drawn by the browser: nothing is converted or sent anywhere else. */
const stage = (attachment: Attachment): Html => {
  const { name, previewUrl } = attachment
  switch (previewKind(name, attachment.contentType)) {
    case 'image':
      return html`<img class="viewer-image" src="${previewUrl}" alt="${name}" />`
    case 'pdf':
      return html`<iframe class="viewer-frame" src="${previewUrl}" title="${name}"></iframe>`
    case 'video':
      return html`<video class="viewer-media" src="${previewUrl}" controls preload="metadata"></video>`
    case 'audio':
      return html`<audio class="viewer-audio" src="${previewUrl}" controls preload="metadata"></audio>`
    case 'text':
      return attachment.size > MAX_TEXT_PREVIEW_BYTES
        ? tooBig(attachment)
        : html`<div class="viewer-text" data-text></div>`
    default:
      return unavailable(attachment, `Não há pré-visualização para arquivos ${typeLabel(name)}.`)
  }
}

/** Text with its line numbers, as an editor shows it; markup in it stays characters. */
const lines = (text: string): Html =>
  html`<ol class="viewer-lines">${text
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .map((line) => html`<li>${line}</li>`)}</ol>`

const _loadText = async (dialog: HTMLDialogElement, attachment: Attachment): Promise<void> => {
  const target = dialog.querySelector<HTMLElement>('[data-text]')
  const text = await fetch(attachment.previewUrl).then((response) => (response.ok ? response.text() : undefined))
  if (target?.isConnected) {
    target.innerHTML = (
      text === undefined ? unavailable(attachment, 'Não foi possível ler o arquivo.') : lines(text)
    ).value
  }
}

/** The browser's own viewer, full page — on a phone, a PDF reads better there than in a frame. */
const newTab = (attachment: Attachment): Html =>
  html`<a class="button button-ghost button-icon" href="${attachment.previewUrl}" target="_blank" rel="noopener noreferrer" aria-label="Abrir em nova aba">${icon('externalLink')}</a>`

const head = (attachment: Attachment, position: string): Html => html`
  <header class="viewer-head glass">
    <span class="viewer-glyph">${icon(fileIcon(attachment), 20)}</span>
    <div class="viewer-title">
      <strong>${attachment.name}</strong>
      <span class="muted">${typeLabel(attachment.name)} · ${fileSize(attachment.size)} · ${attachment.uploadedBy.name} · ${uploadedAt(attachment)}${position}</span>
    </div>
    ${previewKind(attachment.name, attachment.contentType) === 'none' ? '' : newTab(attachment)}
    <a class="button button-ghost button-icon" href="${attachment.url}" download="${attachment.name}" aria-label="Baixar ${attachment.name}">${icon('download')}</a>
    <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button>
  </header>
`

const arrows = (): Html => html`
  <button type="button" class="viewer-step viewer-step-back" data-step="-1" aria-label="Anterior">${icon('chevronLeft', 20)}</button>
  <button type="button" class="viewer-step viewer-step-next" data-step="1" aria-label="Próximo">${icon('chevronRight', 20)}</button>
`

const _draw = (dialog: HTMLDialogElement, attachments: readonly Attachment[], index: number): void => {
  const attachment = attachments[index]
  if (!attachment) {
    return
  }
  const many = attachments.length > 1
  dialog.setAttribute('aria-label', attachment.name)
  dialog.innerHTML = html`
    ${head(attachment, many ? ` · ${index + 1} de ${attachments.length}` : '')}
    <div class="viewer-stage" data-stage>${stage(attachment)}</div>
    ${many ? arrows() : ''}
  `.value
  if (dialog.querySelector('[data-text]')) {
    void _loadText(dialog, attachment).catch(() => undefined)
  }
}

/**
 * The card's files, one at a time, over everything (escopo-mvp 2.9): images, PDFs, video, audio and
 * text are shown in place; anything else offers the download. Arrows walk the card's files.
 */
export const openAttachmentViewer = (attachments: readonly Attachment[], start: number): void => {
  const dialog = document.createElement('dialog')
  dialog.className = 'viewer'
  let index = start
  const step = (by: number) => {
    index = (index + by + attachments.length) % attachments.length
    _draw(dialog, attachments, index)
  }
  const close = () => {
    dialog.close()
    dialog.remove()
  }
  dialog.addEventListener('click', (event) => _onClick(event, step, close))
  dialog.addEventListener('keydown', (event) => _onKey(event, attachments.length > 1 ? step : undefined))
  closeOnEscape(dialog, close)
  document.body.append(dialog)
  _draw(dialog, attachments, index)
  dialog.showModal()
}

/** ← and → walk the files, except where they already mean something — a video's or audio's seek. */
const _onKey = (event: KeyboardEvent, step: ((by: number) => void) | undefined): void => {
  const by = STEPS[event.key]
  if (by && step && !(event.target as HTMLElement).closest('video, audio')) {
    event.preventDefault()
    step(by)
  }
}

/** A click on the empty stage around the file closes, as a click outside a dialog does. */
const _onClick = (event: MouseEvent, step: (by: number) => void, close: () => void): void => {
  const target = event.target as HTMLElement
  const by = target.closest<HTMLElement>('[data-step]')?.dataset.step
  if (by) {
    step(Number(by))
  } else if (target.closest('[data-close]') || target.hasAttribute('data-stage')) {
    close()
  }
}
