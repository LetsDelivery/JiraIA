import { type Form, intakeRead, intakeWrite } from '@/api/intake'
import { read } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'

import { openFormDialog } from './dialog'
import { openFormEditor } from './form-editor'
import { icon } from './icons'
import { toast } from './toast'

/** A form's address: whoever has it — anyone at Let’s — opens it and sends a request. */
export const formPath = (formId: string): string => `/formularios/${formId}`

const formCard = (form: Form, manages: boolean): Html => html`
  <li class="intake-card" data-form="${form.id}">
    <div class="intake-card-head">
      <div class="intake-card-title">
        <h3>${form.name}</h3>
        <span class="badge ${form.enabled ? 'badge-on' : ''}">${form.enabled ? 'Recebendo' : 'Pausado'}</span>
      </div>
      <div class="row">
        <a class="button button-secondary button-small" href="${formPath(form.id)}">${icon('externalLink', 16)}Abrir</a>
        <button type="button" class="button button-ghost button-small" data-copy-form>${icon('link', 16)}Copiar link</button>
        ${
          manages
            ? html`<button type="button" class="button button-ghost button-icon" data-edit-form aria-label="Editar ${form.name}">${icon('pencil', 16)}</button>
          <button type="button" class="button button-ghost button-icon" data-delete-form aria-label="Excluir ${form.name}">${icon('trash', 16)}</button>`
            : ''
        }
      </div>
    </div>
    ${form.description ? html`<p class="muted">${form.description}</p>` : ''}
    <p class="intake-card-meta">${form.questions.length} ${form.questions.length === 1 ? 'pergunta' : 'perguntas'}${form.labels.length ? html` · labels ${form.labels.map((label) => html`<span class="chip">${label}</span>`)}` : ''}</p>
  </li>
`

/**
 * The space's intake forms (escopo-mvp 4.1): each one has a link anyone at Let’s can open, and every
 * answer arrives here as a card. Its admins build them.
 */
export const formsPanel = async (spaceId: string, manages: boolean): Promise<Html> => {
  const forms = (await intakeRead.forms(spaceId)).items
  return html`
    <section class="section">
      <div class="section-head">
        <div>
          <h2>Formulários</h2>
          <p class="muted">Quem preenche não precisa editar o espaço: cada envio vira um card aqui, com as labels do formulário.</p>
        </div>
        ${manages ? html`<button type="button" class="button button-primary" data-new-form>${icon('plus', 16)}Novo formulário</button>` : ''}
      </div>
      ${
        forms.length
          ? html`<ul class="intake-list">${forms.map((form) => formCard(form, manages))}</ul>`
          : html`<div class="empty"><p class="empty-title">Nenhum formulário ainda</p><p class="muted">Um formulário recebe pedidos de outras áreas sem que elas precisem conhecer o fluxo.</p></div>`
      }
    </section>
  `
}

const _confirmDelete = (form: Form, spaceId: string) =>
  openFormDialog({
    title: `Excluir ${form.name}`,
    submit: 'Excluir formulário',
    done: 'Formulário excluído.',
    fields: html`<p class="muted">O link deixa de funcionar. Os cards que ele já criou continuam no espaço.</p>`,
    onSubmit: () => intakeWrite.deleteForm(form.id, spaceId)
  })

const _edit = async (spaceId: string, form?: Form) => {
  const [workflow, fields] = await Promise.all([read.workflow(spaceId), read.fields(spaceId)])
  openFormEditor(spaceId, workflow, fields.items, form)
}

const _act = async (target: HTMLElement, spaceId: string) => {
  const id = target.closest<HTMLElement>('[data-form]')?.dataset.form
  const form = (await intakeRead.forms(spaceId)).items.find((each) => each.id === id)
  if (!form) {
    return
  }
  if (target.closest('[data-copy-form]')) {
    await navigator.clipboard.writeText(`${location.origin}${formPath(form.id)}`)
    toast('Link copiado.')
  } else if (target.closest('[data-edit-form]')) {
    await _edit(spaceId, form)
  } else if (target.closest('[data-delete-form]')) {
    _confirmDelete(form, spaceId)
  }
}

export const bindFormsPanel = (root: HTMLElement, spaceId: string): void => {
  const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
  root.querySelector('[data-new-form]')?.addEventListener('click', () => void _edit(spaceId).catch(refuse))
  root.querySelector('.intake-list')?.addEventListener('click', (event) => {
    void _act(event.target as HTMLElement, spaceId).catch(refuse)
  })
}
