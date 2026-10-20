import { type Automation, intakeWrite, type SlackChannel } from '@/api/intake'
import type { Field, Workflow } from '@/api/requests'
import { GROUP_LABEL, LINK_READING } from '@/lib/automations'
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/cards'
import { type Html, html } from '@/lib/html'

import { type ActionDraft, type Draft, draftOf, emptyAction, payload } from './automation-draft'
import { openEditorDialog } from './editor-dialog'
import { icon } from './icons'
import { selectField } from './select'

/** What the editor needs to offer choices: every space's workflow, the channels, this space's fields. */
export type EditorContext = {
  spaceId: string
  spaces: readonly { id: string; key: string; name: string }[]
  workflows: ReadonlyMap<string, Workflow>
  fields: readonly Field[]
  channels: readonly SlackChannel[]
}

type Option = { value: string; label: string }

const ACTION_KINDS: Option[] = [
  { value: 'create_card', label: 'Criar um card' },
  { value: 'move_linked', label: 'Mover cards vinculados' },
  { value: 'set_state', label: 'Mudar o estado deste card' },
  { value: 'comment', label: 'Comentar neste card' },
  { value: 'slack', label: 'Publicar no Slack' }
]

const FIELDS: Option[] = [
  { value: 'priority', label: 'Prioridade' },
  { value: 'assigneeId', label: 'Responsável' },
  { value: 'labels', label: 'Labels' },
  { value: 'dueDate', label: 'Data limite' },
  { value: 'groupId', label: 'Squad' },
  { value: 'estimate', label: 'Estimativa' }
]

/** How a link choice reads: from the new card's side when creating, from this card's when moving. */
const linkLabel = (verb: string, direction: 'outward' | 'inward', fromNew: boolean): string => {
  if (fromNew) {
    return direction === 'inward' ? `O novo card ${verb} este` : `Este card ${verb} o novo`
  }
  return direction === 'outward' ? `Que este ${verb}` : `Que ${verb.replace(/a$/, 'am')} este`
}

/** The ways two cards tie, read from this card: "que este entrega", "que entregam este". */
const linkOptions = (fromNew: boolean): Option[] =>
  Object.entries(LINK_READING).flatMap(([type, reading]) =>
    (['outward', 'inward'] as const)
      .filter((direction) => type !== 'relates' || direction === 'outward')
      .map((direction) => ({ value: `${type}:${direction}`, label: linkLabel(reading.outward, direction, fromNew) }))
  )

const states = (context: EditorContext, spaceId: string, none?: string): Option[] => [
  ...(none === undefined ? [] : [{ value: '', label: none }]),
  ...(context.workflows.get(spaceId)?.states ?? []).map((state) => ({ value: state.id, label: state.name }))
]
const types = (context: EditorContext, spaceId: string): Option[] => [
  { value: '', label: 'Primeiro tipo do espaço' },
  ...(context.workflows.get(spaceId)?.types ?? []).map((type) => ({ value: type.id, label: type.name }))
]
const spaces = (context: EditorContext): Option[] =>
  context.spaces.map((space) => ({ value: space.id, label: `${space.key} · ${space.name}` }))

const pick = (name: string, label: string, options: Option[], value: string, attr: string): Html =>
  selectField({ name, label, options, value, attributes: html`data-a-field="${attr}"` })

const text = (
  index: number,
  attr: 'title' | 'text' | 'comment',
  label: string,
  value: string,
  long = false
): Html => html`
  <div class="field"><label for="a-${attr}-${index}">${label}</label>
    ${long ? html`<textarea id="a-${attr}-${index}" class="input textarea" rows="2" data-a-field="${attr}">${value}</textarea>` : html`<input id="a-${attr}-${index}" class="input" data-a-field="${attr}" value="${value}" />`}
  </div>
`

const actionInputs = (action: ActionDraft, index: number, context: EditorContext): Html => {
  const bodies: Record<ActionDraft['type'], () => Html> = {
    create_card: () => html`
      <div class="editor-grid">
        ${pick(`a-space-${index}`, 'Espaço', spaces(context), action.spaceId, 'spaceId')}
        ${pick(`a-type-${index}`, 'Tipo', types(context, action.spaceId), action.typeId, 'typeId')}
        ${pick(`a-state-${index}`, 'Estado', states(context, action.spaceId, 'Primeiro estado'), action.stateId, 'stateId')}
        ${pick(`a-link-${index}`, 'Vínculo', [{ value: '', label: 'Sem vínculo' }, ...linkOptions(true)], action.link, 'link')}
      </div>
      ${text(index, 'title', 'Título', action.title)}`,
    move_linked: () => html`
      <div class="editor-grid">
        ${pick(`a-link-${index}`, 'Cards vinculados', linkOptions(false), action.link, 'link')}
        ${pick(`a-space-${index}`, 'No espaço', spaces(context), action.spaceId, 'spaceId')}
        ${pick(`a-state-${index}`, 'Vão para', states(context, action.spaceId), action.stateId, 'stateId')}
      </div>
      ${text(index, 'comment', 'Comentário em cada um (opcional)', action.comment)}`,
    set_state: () =>
      pick(`a-state-${index}`, 'Novo estado', states(context, context.spaceId), action.stateId, 'stateId'),
    comment: () => text(index, 'text', 'Comentário', action.text, true),
    slack: () =>
      context.channels.length
        ? html`${pick(
            `a-channel-${index}`,
            'Canal',
            context.channels.map((channel) => ({ value: channel.id, label: channel.name })),
            action.channelId,
            'channelId'
          )}
          ${text(index, 'text', 'Mensagem', action.text, true)}`
        : html`<p class="muted">Nenhum canal conectado. Um admin da organização conecta em <a class="link" href="/integracoes">Integrações</a>.</p>`
  }
  return bodies[action.type]()
}

const actionRow = (action: ActionDraft, index: number, context: EditorContext): Html => html`
  <li class="editor-action" data-action-index="${index}">
    <div class="editor-action-head">
      <span class="editor-step">${index + 1}</span>
      ${selectField({ name: `a-kind-${index}`, label: `Ação ${index + 1}`, visibleLabel: false, options: ACTION_KINDS, value: action.type, attributes: html`data-a-field="type"` })}
      <button type="button" class="button button-ghost button-icon" data-a-remove aria-label="Remover ação ${index + 1}">${icon('trash', 16)}</button>
    </div>
    ${actionInputs(action, index, context)}
  </li>
`

const whenSection = (draft: Draft, context: EditorContext): Html => html`
  <fieldset class="editor-section"><legend>Quando</legend>
    <div class="editor-grid">
      ${selectField({
        name: 'trigger',
        label: 'Acontece',
        options: [
          { value: 'state_changed', label: 'Um card muda de estado' },
          { value: 'card_created', label: 'Um card é criado' },
          { value: 'field_changed', label: 'Um campo muda' }
        ],
        value: draft.trigger,
        attributes: html`data-d-field="trigger"`
      })}
      ${
        draft.trigger === 'state_changed'
          ? html`
        ${selectField({ name: 'toStateId', label: 'Para o estado', options: states(context, context.spaceId, 'Qualquer estado'), value: draft.toStateId, attributes: html`data-d-field="toStateId"` })}
        ${selectField({ name: 'toGroup', label: 'Ou para um grupo', options: [{ value: '', label: 'Qualquer grupo' }, ...Object.entries(GROUP_LABEL).map(([value, label]) => ({ value, label }))], value: draft.toGroup, attributes: html`data-d-field="toGroup"` })}`
          : ''
      }
      ${draft.trigger === 'field_changed' ? selectField({ name: 'field', label: 'Campo', options: [...FIELDS, ...context.fields.map((field) => ({ value: `field:${field.id}`, label: field.name }))], value: draft.field, attributes: html`data-d-field="field"` }) : ''}
    </div>
  </fieldset>
`

const ifSection = (draft: Draft, context: EditorContext): Html => html`
  <fieldset class="editor-section"><legend>Se <span class="muted">(opcional)</span></legend>
    <div class="editor-grid">
      ${selectField({ name: 'onlyType', label: 'Só do tipo', options: types(context, context.spaceId).map((each) => (each.value ? each : { value: '', label: 'Qualquer tipo' })), value: draft.onlyType, attributes: html`data-d-field="onlyType"` })}
      ${selectField({ name: 'onlyPriority', label: 'Só com prioridade', options: [{ value: '', label: 'Qualquer prioridade' }, ...PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] }))], value: draft.onlyPriority, attributes: html`data-d-field="onlyPriority"` })}
      <div class="field"><label for="only-label">Só com a label</label><input id="only-label" class="input" data-d-text="onlyLabel" value="${draft.onlyLabel}" placeholder="business-form" /></div>
    </div>
  </fieldset>
`

const body = (draft: Draft, context: EditorContext): Html => html`
  <div class="field"><label for="rule-name">Nome</label><input id="rule-name" class="input" data-d-text="name" value="${draft.name}" maxlength="120" required /></div>
  ${whenSection(draft, context)}
  ${ifSection(draft, context)}
  <fieldset class="editor-section"><legend>Então</legend>
    <ol class="editor-actions">${draft.actions.map((action, index) => actionRow(action, index, context))}</ol>
    <button type="button" class="compose-link" data-a-add>${icon('plus', 16)}Adicionar ação</button>
    <p class="field-hint">Nos textos: <code>{{card.key}}</code>, <code>{{card.title}}</code>, <code>{{card.url}}</code>; depois de criar um card, <code>{{created.key}}</code> e <code>{{created.url}}</code>; ao mover vinculados, <code>{{linked.key}}</code>.</p>
  </fieldset>
  <button type="button" class="chip-toggle align-start" data-d-enabled aria-pressed="${draft.enabled}">Ligada</button>
`

/** A choice that changes which inputs are shown draws the editor again; typing never does. */
const REDRAWS = new Set(['trigger', 'type', 'spaceId'])

/** A new kind starts the action over; a new space clears the type and state chosen in the old one. */
const _setAction = (draft: Draft, index: number, field: keyof ActionDraft, value: string): void => {
  const action = draft.actions[index] as ActionDraft
  if (field === 'type') {
    draft.actions[index] = emptyAction(value as ActionDraft['type'], action.spaceId)
    return
  }
  draft.actions[index] = { ...action, [field]: value, ...(field === 'spaceId' ? { typeId: '', stateId: '' } : {}) }
}

const _onSelect = (draft: Draft, target: HTMLElement, value: string, redraw: () => void): void => {
  const row = target.closest<HTMLElement>('[data-action-index]')
  const actionField = target.closest<HTMLElement>('[data-a-field]')?.dataset.aField as keyof ActionDraft | undefined
  const draftField = target.closest<HTMLElement>('[data-d-field]')?.dataset.dField as keyof Draft | undefined
  if (row && actionField) {
    _setAction(draft, Number(row.dataset.actionIndex), actionField, value)
  } else if (draftField) {
    Object.assign(draft, { [draftField]: value })
  }
  if (REDRAWS.has(actionField ?? draftField ?? '')) {
    redraw()
  }
}

const _bind = (root: HTMLElement, draft: Draft, context: EditorContext, redraw: () => void): void => {
  root.addEventListener('select-change', (event) =>
    _onSelect(draft, event.target as HTMLElement, (event as CustomEvent<{ value: string }>).detail.value, redraw)
  )
  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement
    const row = input.closest<HTMLElement>('[data-action-index]')
    if (row && input.dataset.aField) {
      Object.assign(draft.actions[Number(row.dataset.actionIndex)] as ActionDraft, {
        [input.dataset.aField]: input.value
      })
    } else if (input.dataset.dText) {
      Object.assign(draft, { [input.dataset.dText]: input.value })
    }
  })
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-action-index]')
    if (target.closest('[data-a-add]')) {
      draft.actions.push(emptyAction('comment', context.spaceId))
    } else if (target.closest('[data-a-remove]') && row && draft.actions.length > 1) {
      draft.actions.splice(Number(row.dataset.actionIndex), 1)
    } else if (target.closest('[data-d-enabled]')) {
      draft.enabled = !draft.enabled
    } else {
      return
    }
    redraw()
  })
}

/** Creates a rule, or changes one: Quando → Se → Então, every choice from what exists. */
export const openAutomationEditor = (context: EditorContext, rule?: Automation): void => {
  const draft = draftOf(context.spaceId, rule)
  openEditorDialog({
    title: rule ? `Editar ${rule.name}` : 'Nova automação',
    submit: rule ? 'Salvar' : 'Criar automação',
    done: rule ? 'Automação salva.' : 'Automação criada.',
    className: 'editor-wide',
    body: () => body(draft, context),
    bind: (root, redraw) => _bind(root, draft, context, redraw),
    onSubmit: () =>
      rule
        ? intakeWrite.updateAutomation(rule.id, context.spaceId, payload(draft))
        : intakeWrite.createAutomation(context.spaceId, payload(draft))
  })
}
