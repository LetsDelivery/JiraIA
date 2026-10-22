import { type Field, type FieldKind, read, type Workflow, write } from '@/api/requests'
import { parseLabels } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { busy, submitButton } from '@/ui/busy'
import { FIELD_KIND_LABEL } from './custom-fields'
import { icon } from './icons'
import { bindSelects, selectField } from './select'
import { toast } from './toast'

const KIND_OPTIONS = (Object.keys(FIELD_KIND_LABEL) as FieldKind[]).map((kind) => ({
  value: kind,
  label: FIELD_KIND_LABEL[kind]
}))
const isSelection = (kind: string) => kind === 'select' || kind === 'multi_select'

const typeChips = (workflow: Workflow, chosen: readonly string[], scope: string): Html => html`
  <div class="chips" role="group" aria-label="Tipos de card">
    ${workflow.types.map(
      (type) => html`<button type="button" class="chip chip-toggle" data-type-chip="${scope}" data-type="${type.id}"
        aria-pressed="${chosen.includes(type.id)}">${type.name}</button>`
    )}
  </div>
`

const fieldRow = (field: Field, workflow: Workflow): Html => html`
  <li class="field-row" data-field-id="${field.id}">
    <div class="row">
      <label class="sr-only" for="field-${field.id}">Nome do campo</label>
      <input id="field-${field.id}" class="input" data-field-name value="${field.name}" maxlength="60" />
      <span class="badge">${FIELD_KIND_LABEL[field.kind]}</span>
      <button type="button" class="button button-ghost button-icon" data-delete-field aria-label="Excluir ${field.name}">${icon('trash', 16)}</button>
    </div>
    ${
      isSelection(field.kind)
        ? html`<label class="sr-only" for="options-${field.id}">Opções de ${field.name}</label>
          <input id="options-${field.id}" class="input" data-field-options value="${field.options.join(', ')}" placeholder="Opções, separadas por vírgula" />`
        : ''
    }
    ${typeChips(workflow, field.typeIds, field.id)}
  </li>
`

const content = (fields: readonly Field[], workflow: Workflow): Html => html`
  <header class="dialog-header">
    <h2>Campos do espaço</h2>
    <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button>
  </header>
  <div class="dialog-body">
    <p class="muted">Campos além dos padrão. Marque os tipos de card em que cada um aparece; sem marcar, aparece em todos.</p>
    ${fields.length ? html`<ol class="states">${fields.map((field) => fieldRow(field, workflow))}</ol>` : html`<p class="muted">Nenhum campo ainda.</p>`}
    <form class="stack-tight field-add" data-add-field>
      <div class="state-add">
        <label class="sr-only" for="new-field">Novo campo</label>
        <input id="new-field" class="input" name="name" placeholder="Novo campo, ex.: Squad" maxlength="60" required />
        ${selectField({ name: 'kind', label: 'Tipo do novo campo', visibleLabel: false, options: KIND_OPTIONS, value: 'text' })}
        <button type="submit" class="button button-secondary">${icon('plus', 16)}Adicionar</button>
      </div>
      <input class="input" name="options" data-new-options placeholder="Opções, separadas por vírgula (seleção)" hidden />
      ${typeChips(workflow, [], 'new')}
    </form>
  </div>
`

/** The custom fields editor (escopo-mvp 2.5): add, rename, change options and types, delete. */
export const openFieldsEditor = async (spaceId: string): Promise<void> => {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog glass workflow-dialog'
  dialog.setAttribute('aria-label', 'Campos do espaço')
  document.body.append(dialog)
  const close = () => {
    dialog.close()
    dialog.remove()
  }
  dialog.addEventListener('cancel', close)
  dialog.showModal()
  await render(dialog, spaceId, close)
}

const render = async (dialog: HTMLDialogElement, spaceId: string, close: () => void): Promise<void> => {
  const [fields, workflow] = await Promise.all([read.fields(spaceId), read.workflow(spaceId)])
  dialog.innerHTML = content(fields.items, workflow).value
  bindSelects(dialog)
  dialog.querySelector('[data-close]')?.addEventListener('click', close)
  const run = (change: Promise<unknown>) =>
    change
      .then(() => render(dialog, spaceId, close))
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  for (const row of dialog.querySelectorAll<HTMLElement>('[data-field-id]')) {
    bindRow(row, spaceId, fields.items, run)
  }
  bindAdd(dialog, spaceId, run)
}

const chosenTypes = (scope: ParentNode, key: string): string[] =>
  [...scope.querySelectorAll<HTMLElement>(`[data-type-chip="${key}"][aria-pressed="true"]`)].map(
    (chip) => chip.dataset.type ?? ''
  )

const bindRow = (
  row: HTMLElement,
  spaceId: string,
  fields: readonly Field[],
  run: (change: Promise<unknown>) => unknown
) => {
  const fieldId = row.dataset.fieldId ?? ''
  const name = fields.find((field) => field.id === fieldId)?.name ?? ''
  row.querySelector<HTMLInputElement>('[data-field-name]')?.addEventListener('change', (event) => {
    run(write.updateField(spaceId, fieldId, { name: (event.target as HTMLInputElement).value.trim() }))
  })
  row.querySelector<HTMLInputElement>('[data-field-options]')?.addEventListener('change', (event) => {
    run(write.updateField(spaceId, fieldId, { options: parseLabels((event.target as HTMLInputElement).value) }))
  })
  for (const chip of row.querySelectorAll<HTMLElement>('[data-type-chip]')) {
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'))
      run(write.updateField(spaceId, fieldId, { typeIds: chosenTypes(row, fieldId) }))
    })
  }
  row.querySelector('[data-delete-field]')?.addEventListener('click', () => {
    if (
      confirm(`Excluir o campo "${name}"? O valor dele sai de todos os cards; o histórico guarda o que cada um tinha.`)
    ) {
      run(write.deleteField(spaceId, fieldId))
    }
  })
}

const bindAdd = (dialog: HTMLDialogElement, spaceId: string, run: (change: Promise<unknown>) => Promise<unknown>) => {
  const form = dialog.querySelector<HTMLFormElement>('[data-add-field]') as HTMLFormElement
  const options = form.querySelector<HTMLInputElement>('[data-new-options]') as HTMLInputElement
  form.addEventListener('select-change', (event) => {
    options.hidden = !isSelection((event as CustomEvent<{ value: string }>).detail.value)
  })
  for (const chip of form.querySelectorAll<HTMLElement>('[data-type-chip]')) {
    chip.addEventListener('click', () =>
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'))
    )
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const data = new FormData(form)
    const kind = String(data.get('kind')) as FieldKind
    void busy(submitButton(form), () =>
      run(
        write.addField(spaceId, {
          name: String(data.get('name')).trim(),
          kind,
          options: isSelection(kind) ? parseLabels(String(data.get('options') ?? '')) : [],
          typeIds: chosenTypes(form, 'new')
        })
      )
    )
  })
}
