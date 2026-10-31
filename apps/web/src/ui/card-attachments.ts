import { type Attachment, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { fileSize } from '@/lib/relations'

import { fillThumbs, thumb } from './attachment-thumbs'
import { openAttachmentViewer, uploadedAt } from './attachment-viewer'
import { detailPanel } from './detail-panel'
import { icon } from './icons'
import { toast } from './toast'

export type AttachmentsContext = {
  cardId: string
  meId: string
  canWrite: boolean
  manages: boolean
  refresh: () => void
}

const removable = (attachment: Attachment, context: AttachmentsContext): boolean =>
  context.canWrite && (context.manages || attachment.uploadedBy.id === context.meId)

const row = (attachment: Attachment, index: number, context: AttachmentsContext): Html => html`
  <li class="attachment">
    <button type="button" class="attachment-open" data-preview="${index}" aria-label="Visualizar ${attachment.name}">
      ${thumb(attachment)}
      <span class="attachment-text">
        <span class="attachment-name" title="${attachment.name}">${attachment.name}</span>
        <span class="muted">${uploadedAt(attachment)} · ${fileSize(attachment.size)}</span>
      </span>
    </button>
    <div class="attachment-actions">
      <a class="button button-secondary button-icon" href="${attachment.url}" download="${attachment.name}" aria-label="Baixar ${attachment.name}">${icon('download', 16)}</a>
      ${removable(attachment, context) ? html`<button type="button" class="button button-secondary button-icon" data-detach="${attachment.id}" aria-label="Remover ${attachment.name}">${icon('trash', 16)}</button>` : ''}
    </div>
  </li>
`

/**
 * Files on the card (escopo-mvp 2.9), as tiles that open the viewer; images show themselves on the
 * tile. Downloading is the tile's own button. The panel shows once there is a file —
 * they are chosen from the card's action bar, dropped anywhere on the card or pasted in a comment.
 */
export const attachmentsSection = (attachments: readonly Attachment[], context: AttachmentsContext): Html =>
  attachments.length
    ? detailPanel({
        title: html`Anexos <span class="count">${attachments.length}</span>`,
        attributes: html`data-attachments`,
        body: html`<ul class="attachments">${attachments.map((attachment, index) => row(attachment, index, context))}</ul>`
      })
    : html``

/** The action bar's "Anexar": a label over the file input, so it opens the system's picker. */
export const attachButton = (): Html => html`
  <label class="button button-secondary button-small">${icon('paperclip', 16)}Anexar
    <input type="file" class="sr-only" data-file-input multiple aria-label="Anexar arquivo" /></label>
`

/** Uploads one file and draws the card again; a refusal says why in pt-BR. */
export const uploadFile = (context: AttachmentsContext, file: File): void => {
  toast(`Enviando ${file.name}…`)
  write
    .attach(context.cardId, file)
    .then(() => {
      toast(`${file.name} anexado.`)
      context.refresh()
    })
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
}

export const bindAttachments = (
  root: HTMLElement,
  attachments: readonly Attachment[],
  context: AttachmentsContext
): void => {
  void fillThumbs(root, attachments)
  root.querySelector<HTMLElement>('[data-attachments]')?.addEventListener('click', (event) => {
    const index = (event.target as HTMLElement).closest<HTMLElement>('[data-preview]')?.dataset.preview
    if (index !== undefined) {
      openAttachmentViewer(attachments, Number(index))
    }
  })
  if (!context.canWrite) {
    return
  }
  root.querySelector<HTMLInputElement>('[data-file-input]')?.addEventListener('change', (event) => {
    for (const file of (event.target as HTMLInputElement).files ?? []) {
      uploadFile(context, file)
    }
  })
  const zone = root.querySelector<HTMLElement>('[data-drop-files]')
  if (zone) {
    _bindDrop(zone, context)
  }
  root.querySelector<HTMLElement>('[data-attachments]')?.addEventListener('click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-detach]')?.dataset.detach
    if (id) {
      write
        .detach(context.cardId, id)
        .then(context.refresh)
        .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    }
  })
}

/** A file dropped anywhere on the card's reading column goes up; the column rings while one hovers. */
const _bindDrop = (zone: HTMLElement, context: AttachmentsContext): void => {
  const files = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
  zone.addEventListener('dragover', (event) => {
    if (files(event)) {
      event.preventDefault()
      zone.classList.add('is-dropping')
    }
  })
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget as Node | null)) {
      zone.classList.remove('is-dropping')
    }
  })
  zone.addEventListener('drop', (event) => {
    zone.classList.remove('is-dropping')
    // A drop the comment's editor already took is the comment's: it sent the file itself.
    if (!files(event) || event.defaultPrevented) {
      return
    }
    event.preventDefault()
    zone.classList.remove('is-dropping')
    for (const file of event.dataTransfer?.files ?? []) {
      uploadFile(context, file)
    }
  })
}
