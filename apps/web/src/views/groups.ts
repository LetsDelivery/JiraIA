import { accessRead, accessWrite, type Group } from '@/api/access'
import { read } from '@/api/requests'
import { drawSpacePath } from '@/lib/draw'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { ROLE_HINT, ROLE_LABEL } from '@/lib/roles'
import { spacePath } from '@/lib/space-types'
import { openFormDialog, textField } from '@/ui/dialog'
import { toggleFloatingMenu } from '@/ui/floating-menu'
import { icon } from '@/ui/icons'
import { selectField } from '@/ui/select'
import { toast } from '@/ui/toast'

import type { View } from './view'

/**
 * Groups (ADR-0012): an area or a team, so a role given to it reaches everyone in it. Everyone sees
 * them; an organization admin creates and deletes them and names owners; owners add and remove people.
 */
type GroupMember = Group['members'][number]

const memberItem = (group: Group, member: GroupMember) => html`
  <li class="group-member">
    <span class="group-member-who">
      <span class="person-name">${member.name}${member.isOwner ? html`<span class="badge">dono</span>` : ''}</span>
      <span class="muted">${member.email ?? ''}</span>
    </span>
    ${group.canEdit ? html`<button type="button" class="button button-ghost button-icon" data-member-menu="${member.id}" data-group="${group.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Ações de ${member.name}">${icon('dots', 16)}</button>` : ''}
  </li>
`

/** Naming owners is an organization admin's; an owner only adds and removes people. */
const memberMenu = (group: Group, member: GroupMember): Html => html`
  ${group.canManage ? html`<button type="button" role="menuitem" data-action="owner">${icon('shieldCheck', 16)}${member.isOwner ? 'Tirar de dono' : 'Tornar dono'}</button>` : ''}
  <button type="button" role="menuitem" class="is-danger" data-action="leave">${icon('x', 16)}Remover do grupo</button>
`

const MEMBER_ACTIONS: Record<string, (group: Group, member: GroupMember) => Promise<unknown>> = {
  owner: (group, member) => accessWrite.putGroupMember(group.id, member.id, !member.isOwner),
  leave: (group, member) => accessWrite.removeGroupMember(group.id, member.id)
}

const openMemberMenu = async (button: HTMLElement) => {
  const group = (await accessRead.groups()).items.find((each) => each.id === button.dataset.group)
  const member = group?.members.find((each) => each.id === button.dataset.memberMenu)
  if (!group || !member) {
    return
  }
  toggleFloatingMenu({
    anchor: button,
    label: `Ações de ${member.name}`,
    className: 'draw-menu',
    content: memberMenu(group, member),
    onClick: (target) => {
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
      MEMBER_ACTIONS[action ?? '']?.(group, member).catch((refusal: unknown) =>
        toast(refusalSentence(refusal), 'error')
      )
      return action === undefined
    }
  })
}

type Grant = Group['access'][number]

const grantHref = (grant: Grant): string =>
  grant.product === 'jiraia' ? spacePath(grant.label) : drawSpacePath(grant.spaceId)

/** One space the group holds a role on: where, which role, and what that role lets its people do. */
const grantItem = (grant: Grant) => html`
  <li class="group-grant">
    <span class="group-grant-product">${grant.product === 'jiraia' ? 'JiraIA' : 'Draw'}</span>
    <a class="group-grant-space" href="${grantHref(grant)}">
      ${grant.product === 'jiraia' ? html`<span class="key">${grant.label}</span>` : html`<span aria-hidden="true">${grant.label}</span>`}
      <span>${grant.name}</span>
    </a>
    <span class="badge">${ROLE_LABEL[grant.role]}</span>
    <span class="group-grant-hint muted">${ROLE_HINT[grant.role]}</span>
  </li>
`

const peopleColumn = (group: Group) => html`
  <div class="group-column">
    <h3 class="group-column-title">Pessoas</h3>
    ${group.members.length ? html`<ul class="group-members">${group.members.map((member) => memberItem(group, member))}</ul>` : html`<p class="muted">Ninguém no grupo ainda.</p>`}
  </div>
`

/** Where the group can do what — the question "what does being in Produto give me?" answered in place. */
const accessColumn = (group: Group) => html`
  <div class="group-column">
    <h3 class="group-column-title">O que o grupo pode fazer</h3>
    ${
      group.access.length
        ? html`<ul class="group-grants">${group.access.map(grantItem)}</ul>`
        : html`<p class="muted">Sem papel em nenhum espaço — todos leem tudo, como toda a LET’S. O papel do grupo é dado em <strong>Pessoas e papéis</strong> de cada espaço.</p>`
    }
  </div>
`

const groupCard = (group: Group): Html => html`
  <section class="section group-card">
    <div class="group-head">
      ${icon('usersGroup', 20)}<h2>${group.name}</h2>
      <span class="muted">${group.members.length} ${group.members.length === 1 ? 'pessoa' : 'pessoas'} · ${group.access.length} ${group.access.length === 1 ? 'espaço' : 'espaços'}</span>
      <span class="group-head-actions">
        ${group.canEdit ? html`<button type="button" class="button button-secondary" data-join="${group.id}">${icon('userPlus', 16)}Adicionar pessoa</button>` : ''}
        ${group.canManage ? html`<button type="button" class="button button-ghost" data-delete-group="${group.id}" data-name="${group.name}">Excluir grupo</button>` : ''}
      </span>
    </div>
    ${group.description ? html`<p class="muted group-description">${group.description}</p>` : ''}
    <div class="group-columns">${peopleColumn(group)}${accessColumn(group)}</div>
  </section>
`

export const groupsView: View = {
  path: '/grupos',
  skeleton: 'table',
  title: 'Grupos',
  render: async () => {
    const [me, groups] = await Promise.all([read.me(), accessRead.groups()])
    return html`
      <header class="page-header row">
        <h1>Grupos</h1>
        ${me.isOrgAdmin ? html`<button type="button" class="button button-primary" data-new-group>${icon('plus')}Criar grupo</button>` : ''}
      </header>
      <p class="muted groups-intro">Dê um papel a um grupo em um espaço e todos do grupo recebem esse papel.</p>
      ${groups.items.length ? groups.items.map(groupCard) : html`<p class="empty muted">Nenhum grupo ainda.</p>`}
    `
  },
  bind: (root) => {
    root.querySelector('[data-new-group]')?.addEventListener('click', createGroup)
    on(root, 'join', (button) => addMember(button.dataset.join ?? ''))
    on(root, 'member-menu', openMemberMenu)
    on(root, 'delete-group', async (button) => {
      if (confirm(`Excluir o grupo "${button.dataset.name}"? Os papéis dados a ele deixam de valer.`)) {
        await accessWrite.deleteGroup(button.getAttribute('data-delete-group') ?? '')
      }
    })
  }
}

const on = (root: HTMLElement, name: string, act: (button: HTMLElement) => Promise<unknown>) => {
  for (const button of root.querySelectorAll<HTMLElement>(`[data-${name}]`)) {
    button.addEventListener('click', () => {
      act(button).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    })
  }
}

const createGroup = () =>
  openFormDialog({
    title: 'Criar grupo',
    submit: 'Criar',
    done: 'Grupo criado.',
    fields: html`${textField({ name: 'name', label: 'Nome', required: true, maxLength: 80, placeholder: 'Produto' })}
      ${textField({ name: 'description', label: 'Descrição', maxLength: 300 })}`,
    onSubmit: (data) => accessWrite.createGroup(String(data.get('name')).trim(), String(data.get('description')).trim())
  })

const addMember = async (groupId: string) => {
  const [members, groups] = await Promise.all([read.members(), accessRead.groups()])
  const inside = new Set(groups.items.find((group) => group.id === groupId)?.members.map((member) => member.id))
  const options = members.items
    .filter((member) => member.status === 'active' && member.kind === 'person' && !inside.has(member.id))
    .map((member) => ({ value: member.id, label: `${member.name} — ${member.email ?? ''}` }))
  openFormDialog({
    title: 'Adicionar pessoa ao grupo',
    submit: 'Adicionar',
    done: 'Pessoa adicionada ao grupo.',
    fields: selectField({ name: 'memberId', label: 'Pessoa', options }),
    onSubmit: async (data) => {
      const memberId = String(data.get('memberId') ?? '')
      if (!memberId) {
        throw { error: { code: 'VALIDATION_FAILED', message: 'Choose a person' } }
      }
      await accessWrite.putGroupMember(groupId, memberId, false)
    }
  })
}
