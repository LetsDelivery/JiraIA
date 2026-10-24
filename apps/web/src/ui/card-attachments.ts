import { type Attachment, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { fileSize } from '@/lib/relations'

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

const preview = (attachment: Attachment): Html =>
  attachment.contentType.startsWith('image/')
    ? html`<img class="attachment-thumb" src="${attachment.url}" alt="" loading="lazy" />`
    : html`<span class="attachment-thumb attachment-icon">${icon('file', 20)}</span>`

const row = (attachment: Attachment, context: AttachmentsContext): Html => html`
  <li class="attachment">
    ${preview(attachment)}
    <div class="attachment-text">
      <a class="link" href="${attachment.url}" target="_blank" rel="noopener noreferrer" download="${attachment.name}">${attachment.name}</a>
      <span class="muted">${fileSize(attachment.size)} · ${attachment.uploadedBy.name}</span>
    </div>
    ${
      context.canWrite && (context.manages || attachment.uploadedBy.id === context.meId)
        ? html`<button type="button" class="button button-ghost button-icon" data-detach="${attachment.id}" aria-label="Remover ${attachment.name}">${icon('trash', 16)}</button>`
        : ''
    }
  </li>
`

/**
 * Files on the card (escopo-mvp 2.9); images show a preview. The panel shows once there is a file —
 * they are chosen from the card's action bar, dropped anywhere on the card or pasted in a comment.
 */
export const attachmentsSection = (attachments: readonly Attachment[], context: AttachmentsContext): Html =>
  attachments.length
    ? detailPanel({
        title: html`Anexos <span class="count">${attachments.length}</span>`,
        attributes: html`data-attachments`,
        body: html`<ul class="attachments">${attachments.map((attachment) => row(attachment, context))}</ul>`
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

export const bindAttachments = (root: HTMLElement, context: AttachmentsContext): void => {
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
    if (!files(event)) {
      return
    }
    event.preventDefault()
    zone.classList.remove('is-dropping')
    for (const file of event.dataTransfer?.files ?? []) {
      uploadFile(context, file)
    }
  })
}
