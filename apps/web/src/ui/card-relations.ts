import type { Card, CardRef, Link, Relations } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { LINK_CHOICES, LINK_LABEL } from '@/lib/relations'

import { cardPicker } from './card-picker'
import { detailPanel } from './detail-panel'
import { icon } from './icons'
import { selectField } from './select'

export { bindRelations } from './card-relation-forms'

export type ComposeForm = 'subtask' | 'link'

export type RelationsContext = {
  card: Card
  canWrite: boolean
  /** The card types of the space; a new subtask picks one, "Subtarefa" when the space has it. */
  types: readonly { id: string; name: string }[]
  subtaskTypeId: string | undefined
  /** Which composer was open, so a redraw after adding one more keeps it open. */
  composing: ReadonlySet<ComposeForm>
  remember: (form: ComposeForm, open: boolean) => void
  /** Draws the card again after a change. */
  refresh: () => void
  /** Opens another card — here, or in its own space. */
  open: (ref: CardRef) => void
}

const ref = (card: CardRef, extra: Html | string = ''): Html => html`
  <li class="ref">
    <span class="group-dot group-${card.state.group}" aria-hidden="true"></span>
    <button type="button" class="link ref-open" data-open-ref="${card.id}"><span class="card-key">${card.key}</span> ${card.title}</button>
    <span class="muted ref-state">${card.state.name}</span>
    ${extra}
  </li>
`

const count = (n: number): Html | string => (n ? html` <span class="count">${n}</span>` : '')

const removeButton = (attribute: Html, label: string): Html =>
  html`<button type="button" class="button button-ghost button-icon" ${attribute} aria-label="${label}">${icon('x', 16)}</button>`

const linkGroups = (links: readonly Link[], canWrite: boolean): Html => {
  const groups = new Map<string, Link[]>()
  for (const link of links) {
    const label = LINK_LABEL[link.type][link.direction]
    groups.set(label, [...(groups.get(label) ?? []), link])
  }
  return html`${[...groups].map(
    ([label, group]) => html`
      <div class="detail-sub"><p class="detail-link-type">${label}</p>
      <ul class="refs">${group.map((link) =>
        ref(
          link.card,
          canWrite ? removeButton(html`data-unlink="${link.id}"`, `Remover vínculo com ${link.card.key}`) : ''
        )
      )}</ul></div>`
  )}`
}

/** The parent shows here once a card has one; it is set by creating the card as a subtask. */
const parentLine = (relations: Relations, canWrite: boolean): Html | string =>
  relations.parent
    ? html`<div class="detail-sub"><p class="detail-link-type">Card pai</p><ul class="refs">${ref(
        relations.parent,
        canWrite ? removeButton(html`data-clear-parent`, 'Tirar do card pai') : ''
      )}</ul></div>`
    : ''

const footer = (extra: Html): Html => html`
  <div class="compose-foot">
    ${extra}
    <button type="button" class="button button-ghost button-small" data-compose-cancel>Cancelar</button>
  </div>
`

/** Jira's subtask composer: a name, the type, Enter — or pick a card that already exists. */
const subtaskForm = (context: RelationsContext): Html => html`
  <form class="compose" data-add-subtask data-mode="new">
    <div class="compose-field" data-mode-new>
      <label class="sr-only" for="new-subtask">Nova subtarefa</label>
      <input id="new-subtask" class="compose-input" name="title" placeholder="Nomear esta subtarefa" maxlength="255" autocomplete="off" />
      ${selectField({
        name: 'typeId',
        label: 'Tipo da subtarefa',
        visibleLabel: false,
        options: context.types.map((type) => ({ value: type.id, label: type.name })),
        value: context.subtaskTypeId ?? context.types[0]?.id ?? ''
      })}
      <button type="submit" class="button button-ghost button-icon" aria-label="Criar subtarefa">${icon('cornerDownLeft', 16)}</button>
    </div>
    <div data-mode-pick data-subtask-picker>${cardPicker({ id: 'subtask-pick', label: 'Card existente', placeholder: 'Busque um card deste espaço pela chave ou pelo título' })}</div>
    ${footer(html`
      <button type="button" class="compose-link" data-mode-switch="pick">${icon('search', 16)}Escolher um card já criado</button>
      <button type="button" class="compose-link" data-mode-switch="new">${icon('plus', 16)}Criar uma subtarefa nova</button>
      <span class="compose-spacer"></span>`)}
  </form>
`

/** Jira's link composer: how they relate, then a key, a search or a pasted address. */
const linkForm = (): Html => html`
  <form class="compose" data-add-link>
    <div class="compose-row">
      ${selectField({ name: 'choice', label: 'Tipo de vínculo', visibleLabel: false, options: LINK_CHOICES, value: 'relates:outward' })}
      <div data-link-picker>${cardPicker({ id: 'link-key', label: 'Chave do outro card', placeholder: 'Digite, pesquise ou cole a URL' })}</div>
    </div>
    ${footer(html`
      <button type="button" class="compose-link" data-create-linked>${icon('plus', 16)}Criar card vinculado</button>
      <span class="compose-spacer"></span>
      <button type="submit" class="button button-primary button-small" data-link-submit disabled>Vincular</button>`)}
  </form>
`

/** How a panel is drawn: open while its composer is, and hidden while it has nothing and nothing is being added. */
const panelState = (context: RelationsContext, form: ComposeForm, empty: boolean): Html =>
  html`data-compose="${context.composing.has(form) ? 'open' : 'closed'}" data-compose-name="${form}" ${empty ? html`data-empty` : ''}`

const subtasks = (relations: Relations, context: RelationsContext): Html =>
  detailPanel({
    title: html`Subtarefas${count(relations.children.length)}`,
    attributes: panelState(context, 'subtask', relations.children.length === 0),
    body: html`
      ${relations.children.length ? html`<ul class="refs">${relations.children.map((child) => ref(child))}</ul>` : ''}
      ${context.canWrite ? subtaskForm(context) : ''}`
  })

const links = (relations: Relations, context: RelationsContext): Html =>
  detailPanel({
    title: html`Cards vinculados${count(relations.links.length + (relations.parent ? 1 : 0))}`,
    attributes: panelState(context, 'link', relations.links.length === 0 && !relations.parent),
    body: html`
      ${parentLine(relations, context.canWrite)}
      ${linkGroups(relations.links, context.canWrite)}
      ${context.canWrite ? linkForm() : ''}`
  })

/**
 * Subtasks, then the card's parent and typed links (escopo-mvp 2.6, 2.7), each in its own panel. A
 * panel with nothing in it stays out of sight until the card's action bar opens its composer. The
 * wrapper holds no box of its own: it is the one root the binding listens on.
 */
export const relationsSection = (relations: Relations, context: RelationsContext): Html => html`
  <div class="detail-group" data-relations>
    ${subtasks(relations, context)}
    ${links(relations, context)}
  </div>
`
