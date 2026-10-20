import { type Form, type FormInput, intakeWrite } from '@/api/intake'
import type { Field, Workflow } from '@/api/requests'
import { parseLabels } from '@/lib/cards'
import { type Html, html } from '@/lib/html'

import { openEditorDialog } from './editor-dialog'
import { icon } from './icons'
import { selectField } from './select'

type Question = FormInput['questions'][number]
type Draft = {
  name: string
  description: string
  typeId: string
  stateId: string
  labels: string
  questions: Question[]
  enabled: boolean
}

/** Where an answer can go: the card's own fields, then the space's custom fields. */
const targets = (fields: readonly Field[]) => [
  { value: 'title', label: 'Título do card' },
  { value: 'description', label: 'Descrição (vira uma seção)' },
  { value: 'priority', label: 'Prioridade' },
  { value: 'dueDate', label: 'Data limite' },
  ...fields.map((field) => ({ value: `field:${field.id}`, label: `Campo: ${field.name}` }))
]

let sequence = 0
const newQuestion = (target: string): Question => {
  sequence += 1
  return { id: `q-${Date.now().toString(36)}-${sequence}`, label: '', help: '', required: false, target }
}

const draftOf = (form: Form | undefined, workflow: Workflow): Draft => ({
  name: form?.name ?? '',
  description: form?.description ?? '',
  typeId: form?.typeId ?? workflow.types[0]?.id ?? '',
  stateId: form?.stateId ?? '',
  labels: (form?.labels ?? []).join(', '),
  questions: form?.questions.map(({ id, label, help, required, target }) => ({
    id,
    label,
    help,
    required,
    target
  })) ?? [{ ...newQuestion('title'), label: 'O que você precisa?', required: true }],
  enabled: form?.enabled ?? true
})

const questionRow = (question: Question, index: number, fields: readonly Field[]): Html => html`
  <li class="editor-row" data-question="${index}">
    <div class="editor-row-main">
      <label class="sr-only" for="q-label-${index}">Pergunta ${index + 1}</label>
      <input id="q-label-${index}" class="input" data-q-field="label" value="${question.label}" placeholder="Pergunta" maxlength="200" />
      ${selectField({ name: `q-target-${index}`, label: `Destino da pergunta ${index + 1}`, visibleLabel: false, options: targets(fields), value: question.target, attributes: html`data-q-field="target"` })}
      <button type="button" class="chip-toggle" data-q-required aria-pressed="${question.required}">Obrigatória</button>
      <button type="button" class="button button-ghost button-icon" data-q-remove aria-label="Remover pergunta ${index + 1}">${icon('trash', 16)}</button>
    </div>
    <label class="sr-only" for="q-help-${index}">Ajuda da pergunta ${index + 1}</label>
    <input id="q-help-${index}" class="input input-hint" data-q-field="help" value="${question.help}" placeholder="Ajuda opcional, abaixo da pergunta" maxlength="500" />
  </li>
`

const body = (draft: Draft, workflow: Workflow, fields: readonly Field[]): Html => html`
  <div class="field"><label for="form-name">Nome</label><input id="form-name" class="input" data-draft="name" value="${draft.name}" maxlength="120" required /></div>
  <div class="field"><label for="form-description">Texto de abertura</label>
    <textarea id="form-description" class="input textarea" data-draft="description" rows="2" maxlength="2000">${draft.description}</textarea></div>
  <div class="editor-grid">
    ${selectField({ name: 'typeId', label: 'Tipo do card criado', options: workflow.types.map((type) => ({ value: type.id, label: type.name })), value: draft.typeId, attributes: html`data-draft="typeId"` })}
    ${selectField({ name: 'stateId', label: 'Estado inicial', options: [{ value: '', label: 'Primeiro estado do fluxo' }, ...workflow.states.map((state) => ({ value: state.id, label: state.name }))], value: draft.stateId, attributes: html`data-draft="stateId"` })}
  </div>
  <div class="field"><label for="form-labels">Labels automáticas</label>
    <input id="form-labels" class="input" data-draft="labels" value="${draft.labels}" placeholder="business-form" /></div>
  <div class="field">
    <span class="label">Perguntas</span>
    <ol class="editor-rows">${draft.questions.map((question, index) => questionRow(question, index, fields))}</ol>
    <button type="button" class="compose-link" data-q-add>${icon('plus', 16)}Adicionar pergunta</button>
  </div>
  <button type="button" class="chip-toggle align-start" data-draft-enabled aria-pressed="${draft.enabled}">Recebendo respostas</button>
`

const _bindQuestions = (root: HTMLElement, draft: Draft, redraw: () => void): void => {
  root.querySelector('[data-q-add]')?.addEventListener('click', () => {
    draft.questions.push(newQuestion('description'))
    redraw()
  })
  for (const row of root.querySelectorAll<HTMLElement>('[data-question]')) {
    const question = draft.questions[Number(row.dataset.question)] as Question
    row.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement
      if (input.dataset.qField === 'label' || input.dataset.qField === 'help') {
        question[input.dataset.qField] = input.value
      }
    })
    row.addEventListener('select-change', (event) => {
      question.target = (event as CustomEvent<{ value: string }>).detail.value
    })
    row.querySelector('[data-q-required]')?.addEventListener('click', () => {
      question.required = !question.required
      redraw()
    })
    row.querySelector('[data-q-remove]')?.addEventListener('click', () => {
      draft.questions.splice(draft.questions.indexOf(question), 1)
      redraw()
    })
  }
}

const _bind = (root: HTMLElement, draft: Draft, redraw: () => void): void => {
  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement
    const key = input.dataset.draft as 'name' | 'description' | 'labels' | undefined
    if (key) {
      draft[key] = input.value
    }
  })
  root.addEventListener('select-change', (event) => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-draft]')?.dataset.draft
    if (key === 'typeId' || key === 'stateId') {
      draft[key] = (event as CustomEvent<{ value: string }>).detail.value
    }
  })
  root.querySelector('[data-draft-enabled]')?.addEventListener('click', () => {
    draft.enabled = !draft.enabled
    redraw()
  })
  _bindQuestions(root, draft, redraw)
}

const payload = (draft: Draft): FormInput => ({
  name: draft.name.trim(),
  description: draft.description,
  typeId: draft.typeId,
  stateId: draft.stateId || null,
  labels: parseLabels(draft.labels),
  questions: draft.questions.map((question) => ({ ...question, label: question.label.trim() })),
  enabled: draft.enabled
})

/** Builds a new intake form, or changes one: the questions in order, and where each answer goes. */
export const openFormEditor = (spaceId: string, workflow: Workflow, fields: readonly Field[], form?: Form): void => {
  const draft = draftOf(form, workflow)
  openEditorDialog({
    title: form ? `Editar ${form.name}` : 'Novo formulário',
    submit: form ? 'Salvar' : 'Criar formulário',
    done: form ? 'Formulário salvo.' : 'Formulário criado.',
    className: 'editor-wide',
    body: () => body(draft, workflow, fields),
    bind: (root, redraw) => _bind(root, draft, redraw),
    onSubmit: () =>
      form ? intakeWrite.updateForm(form.id, spaceId, payload(draft)) : intakeWrite.createForm(spaceId, payload(draft))
  })
}
