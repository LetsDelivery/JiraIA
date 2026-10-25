import {
  type AccessRequest,
  type AccessSource,
  accessRead,
  accessWrite,
  type GrantRole,
  type Grants,
  type Product
} from '@/api/access'
import { read } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { ROLE_LABEL, ROLE_OPTIONS } from '@/lib/roles'

import { openFormDialog, openNotice } from './dialog'
import { icon } from './icons'
import { selectField } from './select'
import { toast } from './toast'

/**
 * "Pessoas e papéis" of a space, in either product (ADR-0012): the access all of LET’S has, the
 * requests waiting, the groups and the people given a role. Its admins change them; everyone sees them.
 */
type Row = { id: string; name: string; detail: string; role: GrantRole; kind: 'group' | 'person' }

const roleCell = (row: Row, manages: boolean) =>
  manages
    ? selectField({
        name: `role-${row.id}`,
        label: `Papel de ${row.name}`,
        options: ROLE_OPTIONS,
        value: row.role,
        visibleLabel: false,
        attributes: html`data-${row.kind}-role="${row.id}"`
      })
    : ROLE_LABEL[row.role]

const grantRow = (row: Row, manages: boolean) => html`
  <tr>
    <td>${row.kind === 'group' ? html`${icon('usersGroup', 16)} ` : ''}${row.name}</td>
    <td class="muted">${row.detail}</td>
    <td>${roleCell(row, manages)}</td>
    <td class="actions">
      ${row.kind === 'person' ? html`<button type="button" class="button button-ghost" data-why="${row.id}" data-name="${row.name}">Por quê?</button>` : ''}
      ${manages ? html`<button type="button" class="button button-ghost" data-remove-${row.kind}="${row.id}">Remover</button>` : ''}
    </td>
  </tr>
`

const grantTable = (title: string, rows: readonly Row[], manages: boolean, add: Html, empty: string) => html`
  <section class="section">
    <div class="row"><h2>${title}</h2>${manages ? add : ''}</div>
    ${
      rows.length === 0
        ? html`<p class="muted">${empty}</p>`
        : html`<table class="table">
            <thead><tr><th>Nome</th><th></th><th>Papel</th><th><span class="sr-only">Ações</span></th></tr></thead>
            <tbody>${rows.map((row) => grantRow(row, manages))}</tbody>
          </table>`
    }
  </section>
`

const openToAll = html`
  <section class="section access-general">
    <h2>Acesso geral</h2>
    <p class="row">${icon('world', 18)}<strong>Toda a LET’S</strong><span class="badge">Leitor</span></p>
    <p class="muted">Todo mundo da LET’S vê este espaço. Para editar, é preciso um papel — direto ou por um grupo.</p>
  </section>
`

/** A restricted or personal wiki collection (ADR-0034): nobody reads it without a role. */
const onlyWithRole = html`
  <section class="section access-general">
    <h2>Acesso geral</h2>
    <p class="row">${icon('lock', 18)}<strong>Só quem tem papel</strong></p>
    <p class="muted">Só as pessoas e os grupos abaixo veem este espaço. Leitor lê; membro edita; administrador cuida das pessoas e das configurações.</p>
  </section>
`

const general = (grants: Grants): Html => (grants.general ? openToAll : onlyWithRole)

const requestRow = (request: AccessRequest) => html`
  <li class="request-row">
    <div><strong>${request.member.name}</strong> <span class="muted">${request.member.email ?? ''}</span>
      ${request.message ? html`<p class="muted">“${request.message}”</p>` : ''}</div>
    <div class="row">
      <button type="button" class="button button-primary" data-approve="${request.id}">Aprovar como membro</button>
      <button type="button" class="button button-ghost" data-decline="${request.id}">Recusar</button>
    </div>
  </li>
`

const requestsSection = (requests: readonly AccessRequest[]) =>
  requests.length === 0
    ? html``
    : html`<section class="section"><h2>Pedidos para editar</h2><ul class="request-list">${requests.map(requestRow)}</ul></section>`

const _rows = (grants: Grants) => ({
  groups: grants.groups.map(
    (group): Row => ({
      id: group.groupId,
      name: group.name,
      detail: `${group.memberCount} ${group.memberCount === 1 ? 'pessoa' : 'pessoas'}`,
      role: group.role,
      kind: 'group'
    })
  ),
  people: grants.people.map(
    (person): Row => ({
      id: person.memberId,
      name: person.name,
      detail: person.email ?? '',
      role: person.role,
      kind: 'person'
    })
  )
})

export const accessPanel = async (product: Product, spaceId: string): Promise<Html> => {
  const grants = await accessRead.grants(product, spaceId)
  const requests = grants.canManage ? (await accessRead.requests(product, spaceId)).items : []
  const { groups, people } = _rows(grants)
  const manages = grants.canManage
  const addGroup = html`<button type="button" class="button button-secondary" data-add-group>${icon('usersGroup', 16)}Adicionar grupo</button>`
  const addPerson = html`<button type="button" class="button button-secondary" data-add-person>${icon('userPlus', 16)}Adicionar pessoa</button>`
  return html`
    ${requestsSection(requests)}
    ${general(grants)}
    ${grantTable('Grupos', groups, manages, addGroup, 'Nenhum grupo com papel aqui.')}
    ${grantTable('Pessoas', people, manages, addPerson, 'Ninguém com papel direto aqui.')}
  `
}

const SOURCE: Record<AccessSource['source'], (source: AccessSource) => string> = {
  organization_admin: () => 'Administra a organização — é administrador em todo espaço.',
  direct: (source) => `Papel dado à pessoa: ${ROLE_LABEL[source.role]}.`,
  group: (source) => `Pelo grupo ${'groupName' in source ? source.groupName : ''}: ${ROLE_LABEL[source.role]}.`,
  organization: () => 'Toda a LET’S: Leitor.'
}

const explain = async (product: Product, spaceId: string, memberId: string, name: string) => {
  const access = await accessRead.explain(product, spaceId, memberId)
  const role = access.role ? ROLE_LABEL[access.role] : 'nenhum'
  openNotice(
    `Por que ${name} tem acesso`,
    html`<p>Papel efetivo: <strong>${role}</strong> — o mais forte entre:</p>
      <ul class="source-list">${access.sources.map((source) => html`<li>${SOURCE[source.source](source)}</li>`)}</ul>`
  )
}

const addGroupDialog = async (product: Product, spaceId: string) => {
  const [groups, grants] = await Promise.all([accessRead.groups(), accessRead.grants(product, spaceId)])
  const holding = new Set(grants.groups.map((group) => group.groupId))
  const options = groups.items.filter((group) => !holding.has(group.id)).map((g) => ({ value: g.id, label: g.name }))
  openFormDialog({
    title: 'Dar papel a um grupo',
    submit: 'Adicionar',
    done: 'Grupo adicionado.',
    fields: html`${selectField({ name: 'groupId', label: 'Grupo', options })}
      ${selectField({ name: 'role', label: 'Papel', options: ROLE_OPTIONS, value: 'member' })}`,
    onSubmit: (data) => accessWrite.putGroupRole(product, spaceId, _chosen(data, 'groupId'), _role(data))
  })
}

const addPersonDialog = async (product: Product, spaceId: string) => {
  const [members, grants] = await Promise.all([read.members(), accessRead.grants(product, spaceId)])
  const holding = new Set(grants.people.map((person) => person.memberId))
  const options = members.items
    .filter((member) => member.status === 'active' && !member.isSystem && !holding.has(member.id))
    .map((member) => ({ value: member.id, label: `${member.name} — ${member.email ?? ''}` }))
  openFormDialog({
    title: 'Dar papel a uma pessoa',
    submit: 'Adicionar',
    done: 'Pessoa adicionada.',
    fields: html`${selectField({ name: 'memberId', label: 'Pessoa', options })}
      ${selectField({ name: 'role', label: 'Papel', options: ROLE_OPTIONS, value: 'member' })}`,
    onSubmit: (data) => accessWrite.putPersonRole(product, spaceId, _chosen(data, 'memberId'), _role(data))
  })
}

const _chosen = (data: FormData, field: string): string => {
  const value = String(data.get(field) ?? '')
  if (!value) {
    throw { error: { code: 'VALIDATION_FAILED', message: `Choose a ${field}` } }
  }
  return value
}

const _role = (data: FormData): GrantRole => {
  const role = ROLE_OPTIONS.find((option) => option.value === data.get('role'))
  return role?.value ?? 'member'
}

/** Buttons that act on one row: `[data-<name>="<id>"]` calls `act(id, button)`. */
const onEach = (root: HTMLElement, name: string, act: (id: string, button: HTMLElement) => Promise<unknown>) => {
  for (const button of root.querySelectorAll<HTMLElement>(`[data-${name}]`)) {
    button.addEventListener('click', () => {
      act(button.getAttribute(`data-${name}`) ?? '', button).catch((refusal) =>
        toast(refusalSentence(refusal), 'error')
      )
    })
  }
}

const decide = async (product: Product, spaceId: string, requestId: string, approve: boolean) => {
  const request = (await accessRead.requests(product, spaceId)).items.find((each) => each.id === requestId)
  if (request) {
    await accessWrite.decide(request, approve)
    toast(approve ? `${request.member.name} agora edita este espaço.` : 'Pedido recusado.')
  }
}

export const bindAccessPanel = (root: HTMLElement, product: Product, spaceId: string): void => {
  const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
  root
    .querySelector('[data-add-group]')
    ?.addEventListener('click', () => addGroupDialog(product, spaceId).catch(refuse))
  root
    .querySelector('[data-add-person]')
    ?.addEventListener('click', () => addPersonDialog(product, spaceId).catch(refuse))
  onEach(root, 'why', (id, button) => explain(product, spaceId, id, button.dataset.name ?? ''))
  onEach(root, 'remove-group', (id) => accessWrite.removeGroupRole(product, spaceId, id))
  onEach(root, 'remove-person', (id) => accessWrite.removePersonRole(product, spaceId, id))
  onEach(root, 'approve', (id) => decide(product, spaceId, id, true))
  onEach(root, 'decline', (id) => decide(product, spaceId, id, false))
  root.addEventListener('select-change', (event) => {
    const target = event.target as HTMLElement
    const role = (event as CustomEvent<{ value: GrantRole }>).detail.value
    const group = target.dataset.groupRole
    const person = target.dataset.personRole
    const saving = group
      ? accessWrite.putGroupRole(product, spaceId, group, role)
      : person && accessWrite.putPersonRole(product, spaceId, person, role)
    Promise.resolve(saving).catch(refuse)
  })
}
