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

/** Files on the card (escopo-mvp 2.9): choose, drop or paste them; images show a preview. */
export const attachmentsSection = (attachments: readonly Attachment[], context: AttachmentsContext): Html =>
  detailPanel({
    title: html`Anexos${attachments.length ? html` <span class="count">${attachments.length}</span>` : ''}`,
    attributes: html`data-attachments`,
    actions: context.canWrite
      ? html`<label class="button button-ghost button-small">${icon('upload', 16)}Anexar
          <input type="file" class="sr-only" data-file-input multiple /></label>`
      : html``,
    body: attachments.length
      ? html`<ul class="attachments">${attachments.map((attachment) => row(attachment, context))}</ul>`
      : html`<p class="muted">${context.canWrite ? 'Nenhum anexo. Arraste um arquivo para cá.' : 'Nenhum anexo.'}</p>`
  })

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
  const section = root.querySelector<HTMLElement>('[data-attachments]')
  if (!section || !context.canWrite) {
    return
  }
  section.querySelector<HTMLInputElement>('[data-file-input]')?.addEventListener('change', (event) => {
    for (const file of (event.target as HTMLInputElement).files ?? []) {
      uploadFile(context, file)
    }
  })
  section.addEventListener('dragover', (event) => {
    event.preventDefault()
    section.classList.add('is-dropping')
  })
  section.addEventListener('dragleave', () => section.classList.remove('is-dropping'))
  section.addEventListener('drop', (event) => {
    event.preventDefault()
    section.classList.remove('is-dropping')
    for (const file of event.dataTransfer?.files ?? []) {
      uploadFile(context, file)
    }
  })
  section.addEventListener('click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-detach]')?.dataset.detach
    if (id) {
      write
        .detach(context.cardId, id)
        .then(context.refresh)
        .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    }
  })
}
