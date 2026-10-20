import { accessWrite, type Group } from '@/api/access'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { squadTone } from '@/lib/squad'

import { openFormDialog, textField } from './dialog'
import { icon } from './icons'
import { toast } from './toast'

export type SquadContext = {
  current: { id: string; name: string } | null
  groups: readonly Group[]
  canWrite: boolean
  /** Organization admins create groups (ADR-0012), so only they see "Criar squad". */
  canCreate: boolean
  choose: (groupId: string | null) => void
  /** Draws the card again after a group is renamed or deleted. */
  refresh: () => void
}

/** A squad as a coloured tag: the colour comes from the group's id, so it is the same everywhere. */
export const squadChip = (group: { id: string; name: string }): Html =>
  html`<span class="squad-chip squad-tone-${squadTone(group.id)}">${group.name}</span>`

const option = (group: Group, chosen: boolean): Html => html`
  <li class="squad-option" role="presentation" data-name="${group.name.toLowerCase()}">
    <div role="option" tabindex="-1" data-group-id="${group.id}" aria-selected="${chosen}">${squadChip(group)}</div>
    ${
      group.canManage
        ? html`<span class="squad-actions">
            <button type="button" class="button button-ghost button-icon" data-squad-rename="${group.id}" aria-label="Renomear ${group.name}">${icon('pencil', 16)}</button>
            <button type="button" class="button button-ghost button-icon" data-squad-delete="${group.id}" aria-label="Apagar ${group.name}">${icon('trash', 16)}</button>
          </span>`
        : ''
    }
  </li>
`

const menu = (context: SquadContext): Html => html`
  <div class="select-menu glass squad-menu" data-squad-menu hidden>
    <label class="sr-only" for="squad-search">Buscar squad</label>
    <input id="squad-search" class="input" placeholder="Buscar squad" autocomplete="off" data-squad-search />
    <ul class="squad-list" role="listbox" id="squad-list" aria-label="Squads">
      ${context.groups.map((group) => option(group, group.id === context.current?.id))}
    </ul>
    <p class="muted squad-empty" data-squad-empty hidden>Nenhuma squad com esse nome.</p>
    ${context.canCreate ? html`<button type="button" class="compose-link squad-create" data-squad-create hidden>${icon('plus', 16)}<span>Criar squad “<span data-squad-new></span>”</span></button>` : ''}
  </div>
`

/**
 * The card's squad as Jira shows it: the tag itself is the control. It opens a list to search, with
 * every squad in its colour; an admin renames, deletes or creates squads right there.
 */
export const squadField = (context: SquadContext): Html => {
  const value = context.current ? squadChip(context.current) : html`<span class="muted">Sem squad</span>`
  if (!context.canWrite) {
    return html`<div class="squad-field">${value}</div>`
  }
  return html`
    <div class="squad-field" data-squad>
      <button type="button" class="squad-trigger" role="combobox" aria-label="Squad" aria-haspopup="listbox"
        aria-expanded="false" aria-controls="squad-list">${value}${icon('chevronDown', 16)}</button>
      ${context.current ? html`<button type="button" class="button button-ghost button-icon" data-squad-clear aria-label="Tirar a squad">${icon('x', 16)}</button>` : ''}
      ${menu(context)}
    </div>
  `
}

const _open = (root: HTMLElement, open: boolean): void => {
  const panel = root.querySelector('[data-squad-menu]') as HTMLElement
  panel.hidden = !open
  root.querySelector('.squad-trigger')?.setAttribute('aria-expanded', String(open))
  if (open) {
    root.querySelector<HTMLInputElement>('[data-squad-search]')?.focus()
  }
}

/** Typing narrows the list; a name nobody has yet is offered to create. */
const _filter = (root: HTMLElement, query: string): void => {
  const wanted = query.trim().toLowerCase()
  let shown = 0
  for (const each of root.querySelectorAll<HTMLElement>('.squad-option')) {
    each.hidden = !(each.dataset.name ?? '').includes(wanted)
    shown += each.hidden ? 0 : 1
  }
  const exact = [...root.querySelectorAll<HTMLElement>('.squad-option')].some((each) => each.dataset.name === wanted)
  const create = root.querySelector<HTMLElement>('[data-squad-create]')
  if (create) {
    create.hidden = !wanted || exact
    create.querySelector('[data-squad-new]')?.replaceChildren(query.trim())
  }
  ;(root.querySelector('[data-squad-empty]') as HTMLElement).hidden = shown > 0 || Boolean(create && !create.hidden)
}

export const bindSquadField = (scope: HTMLElement, context: SquadContext): void => {
  const root = scope.querySelector<HTMLElement>('[data-squad]')
  if (!root) {
    return
  }
  const search = root.querySelector('[data-squad-search]') as HTMLInputElement
  root
    .querySelector('.squad-trigger')
    ?.addEventListener('click', () =>
      _open(root, root.querySelector('[data-squad-menu]')?.hasAttribute('hidden') ?? false)
    )
  root.querySelector('[data-squad-clear]')?.addEventListener('click', () => context.choose(null))
  search.addEventListener('input', () => _filter(root, search.value))
  root.addEventListener('click', (event) => _onMenuClick(root, event, context))
  root.addEventListener('keydown', (event) => _onKey(root, event))
  scope.addEventListener('click', (event) => root.contains(event.target as Node) || _open(root, false))
}

const _onMenuClick = (root: HTMLElement, event: Event, context: SquadContext): void => {
  const target = event.target as HTMLElement
  const byId = (id: string | undefined) => context.groups.find((group) => group.id === id)
  const chosen = target.closest<HTMLElement>('[data-group-id]')?.dataset.groupId
  const renamed = byId(target.closest<HTMLElement>('[data-squad-rename]')?.dataset.squadRename)
  const deleted = byId(target.closest<HTMLElement>('[data-squad-delete]')?.dataset.squadDelete)
  if (chosen) {
    context.choose(chosen)
  } else if (renamed) {
    _rename(renamed, context)
  } else if (deleted) {
    _delete(deleted, context)
  } else if (target.closest('[data-squad-create]')) {
    const name = (root.querySelector('[data-squad-search]') as HTMLInputElement).value.trim()
    void accessWrite
      .createGroup(name, '')
      .then((group) => context.choose(group.id))
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  }
}

/** Arrows walk the list from the search box; Enter picks; Escape closes the list, not the card. */
const _onKey = (root: HTMLElement, event: KeyboardEvent): void => {
  const options = [...root.querySelectorAll<HTMLElement>('.squad-option:not([hidden]) [role="option"]')]
  const index = options.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'Escape' && !root.querySelector('[data-squad-menu]')?.hasAttribute('hidden')) {
    event.preventDefault()
    _open(root, false)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    options[Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  } else if (event.key === 'Enter' && index >= 0) {
    event.preventDefault()
    options[index]?.click()
  }
}

const _rename = (group: Group, context: SquadContext): void =>
  openFormDialog({
    title: `Renomear ${group.name}`,
    submit: 'Salvar',
    done: 'Squad renomeada.',
    fields: textField({ name: 'name', label: 'Nome', required: true, maxLength: 80, value: group.name }),
    onSubmit: (data) => accessWrite.renameGroup(group.id, String(data.get('name')).trim()).then(context.refresh)
  })

const _delete = (group: Group, context: SquadContext): void =>
  openFormDialog({
    title: `Apagar ${group.name}`,
    submit: 'Apagar squad',
    done: 'Squad apagada.',
    fields: html`<p class="muted">${group.name} é um grupo da organização: apagar tira os papéis que ele dá nos espaços e o tira da lista de squads.</p>`,
    onSubmit: () => accessWrite.deleteGroup(group.id).then(context.refresh)
  })
