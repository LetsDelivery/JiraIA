import { accessWrite } from '@/api/access'
import { governanceWrite } from '@/api/governance'
import { type Me, type Member, read, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { avatar } from '@/ui/avatar'
import { openFormDialog, textField } from '@/ui/dialog'
import { toggleFloatingMenu } from '@/ui/floating-menu'
import { icon } from '@/ui/icons'
import { selectField } from '@/ui/select'
import { toast } from '@/ui/toast'

import type { View } from './view'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Desativados' },
  { value: 'all', label: 'Todos' }
]

const ROLE_OPTIONS = [
  { value: '', label: 'Todos os papéis' },
  { value: 'admin', label: 'Admins' },
  { value: 'manager', label: 'Gestores de espaços' },
  { value: 'auditor', label: 'Auditores de acessos' },
  { value: 'none', label: 'Sem papel' }
]

/** The roles a row matches in the Papel filter, as the badges show them. */
const rolesOf = (member: Member): string => {
  const roles = [
    member.isOrgAdmin && 'admin',
    member.isSpaceManager && !member.isOrgAdmin && 'manager',
    member.isAccessAuditor && 'auditor'
  ].filter(Boolean)

  return roles.length > 0 ? roles.join(' ') : 'none'
}

/** Whether an organization admin can act on this person: someone else, still active. */
const actsOn = (me: Me, member: Member): boolean => me.isOrgAdmin && member.status === 'active' && member.id !== me.id

/**
 * The actions on one person, behind ⋯. An organization admin already creates spaces, so only someone
 * else can be made a space manager (ADR-0012).
 */
const actionsMenu = (member: Member): Html => html`
  <button type="button" role="menuitem" data-action="admin">${icon('shieldCheck', 16)}${member.isOrgAdmin ? 'Remover admin' : 'Tornar admin'}</button>
  ${
    member.isOrgAdmin
      ? ''
      : html`<button type="button" role="menuitem" data-action="manager" title="Gestores criam espaços no JiraIA">
          ${icon('layoutGrid', 16)}${member.isSpaceManager ? 'Remover gestor de espaços' : 'Tornar gestor de espaços'}</button>`
  }
  <button type="button" role="menuitem" data-action="auditor" title="Auditores leem e exportam tudo em Acessos">
    ${icon('eye', 16)}${member.isAccessAuditor ? 'Remover auditor de acessos' : 'Tornar auditor de acessos'}</button>
  <button type="button" role="menuitem" class="is-danger" data-action="deactivate">${icon('x', 16)}Desativar</button>
`

const badges = (member: Member): Html => html`
  ${member.isOrgAdmin ? html`<span class="badge">admin</span>` : ''}
  ${member.isSpaceManager && !member.isOrgAdmin ? html`<span class="badge" title="Cria espaços no JiraIA">gestor</span>` : ''}
  ${member.isAccessAuditor ? html`<span class="badge" title="Lê e exporta tudo em Acessos">auditor</span>` : ''}
`

/** One row, carrying what the search and the filters match on, so filtering never re-renders. */
const memberRow = (me: Me, member: Member): Html => html`
  <tr
    data-search="${`${member.name} ${member.email ?? ''} ${member.jobTitle ?? ''}`.toLowerCase()}"
    data-roles="${rolesOf(member)}"
    data-status="${member.status}"
  >
    <td><span class="person-name">${avatar(member)}${member.name}${badges(member)}</span></td>
    <td>${member.jobTitle ?? html`<span class="muted">—</span>`}</td>
    <td class="muted">${member.email}</td>
    <td>${member.status === 'active' ? 'Ativo' : 'Desativado'}</td>
    <td class="actions">
      ${actsOn(me, member) ? html`<button type="button" class="button button-ghost button-icon" data-member-menu="${member.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Ações de ${member.name}">${icon('dots', 16)}</button>` : ''}
    </td>
  </tr>
`

/** What each item of the ⋯ menu does to the person. */
const ACTIONS: Record<string, (member: Member) => Promise<unknown>> = {
  admin: (member) => write.setOrgAdmin(member.id, !member.isOrgAdmin),
  manager: (member) => accessWrite.setSpaceManager(member.id, !member.isSpaceManager),
  auditor: (member) => governanceWrite.setAuditor(member.id, !member.isAccessAuditor),
  deactivate: async (member) => {
    if (confirm(`Desativar ${member.name}? A pessoa deixa de entrar, e o histórico fica.`)) {
      await write.deactivate(member.id)
      toast(`${member.name} foi desativado.`)
    }
  }
}

const openMenu = (anchor: HTMLElement, member: Member) =>
  toggleFloatingMenu({
    anchor,
    label: `Ações de ${member.name}`,
    className: 'draw-menu',
    content: actionsMenu(member),
    onClick: (target) => {
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
      ACTIONS[action ?? '']?.(member).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
      return action === undefined
    }
  })

const toolbar = (): Html => html`
  <div class="toolbar">
    <label class="search">
      <span class="sr-only">Pesquisar pessoas</span>
      <input type="search" class="input" data-search-input placeholder="Pesquisar por nome, e-mail ou cargo" />
    </label>
    ${selectField({ name: 'filter-role', label: 'Papel', visibleLabel: false, options: ROLE_OPTIONS, value: '', attributes: html`data-filter="role"` })}
    ${selectField({ name: 'filter-status', label: 'Situação', visibleLabel: false, options: STATUS_OPTIONS, value: 'active', attributes: html`data-filter="status"` })}
  </div>
`

/** Shows the rows that match the search and every filter; counts them. Active people by default. */
const bindFilters = (root: HTMLElement): void => {
  const search = root.querySelector<HTMLInputElement>('[data-search-input]')
  const filterValue = (name: string) =>
    root.querySelector<HTMLInputElement>(`[data-filter="${name}"] input[type="hidden"]`)?.value ?? ''
  const rows = [...root.querySelectorAll<HTMLTableRowElement>('tbody tr')]

  const apply = () => {
    const query = (search?.value ?? '').trim().toLowerCase()
    const [role, status] = [filterValue('role'), filterValue('status')]
    const matches = (row: HTMLTableRowElement) =>
      (row.dataset.search ?? '').includes(query) &&
      (!role || (row.dataset.roles ?? '').split(' ').includes(role)) &&
      (status === 'all' || row.dataset.status === status)
    const shown = rows.filter((row) => !row.toggleAttribute('hidden', !matches(row)))

    root.querySelector('[data-no-match]')?.toggleAttribute('hidden', shown.length > 0)
    root.querySelector('[data-count]')?.replaceChildren(`${shown.length} ${shown.length === 1 ? 'pessoa' : 'pessoas'}`)
  }

  search?.addEventListener('input', apply)
  root.addEventListener('select-change', apply)
  apply()
}

const invite = () =>
  openFormDialog({
    title: 'Convidar pessoa',
    submit: 'Convidar',
    done: 'Convite feito. A pessoa já pode entrar com a conta Google.',
    fields: html`${textField({ name: 'name', label: 'Nome', required: true, maxLength: 120 })}
      ${textField({ name: 'jobTitle', label: 'Cargo', hint: 'Opcional. A pessoa pode mudar no próprio perfil.', maxLength: 80 })}
      ${textField({ name: 'email', label: 'E-mail corporativo', type: 'email', required: true })}`,
    onSubmit: (data) =>
      write.invite({
        name: String(data.get('name')),
        jobTitle: String(data.get('jobTitle')).trim() || null,
        email: String(data.get('email')).toLowerCase(),
        isOrgAdmin: false
      })
  })

/** The organization's people. Deactivating keeps the person in history (escopo-mvp 1.4). */
export const peopleView: View = {
  path: '/pessoas',
  skeleton: 'table',
  title: 'Pessoas',
  render: async () => {
    const [me, members] = await Promise.all([read.me(), read.members()])

    return html`
      <header class="page-header row">
        <div class="stack-tight">
          <h1>Pessoas</h1>
          <p class="muted" data-count></p>
        </div>
        ${me.isOrgAdmin ? html`<button type="button" class="button button-primary" data-invite>${icon('plus')}Convidar pessoa</button>` : ''}
      </header>
      ${toolbar()}
      <table class="table people-table">
        <thead><tr><th>Nome</th><th>Cargo</th><th>E-mail</th><th>Status</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>
          ${members.items.filter((member) => member.kind === 'person').map((member) => memberRow(me, member))}
        </tbody>
      </table>
      <p class="empty muted" data-no-match hidden>Nenhuma pessoa corresponde à pesquisa e aos filtros.</p>
    `
  },
  bind: (root) => {
    bindFilters(root)
    root.querySelector('[data-invite]')?.addEventListener('click', invite)
    for (const button of root.querySelectorAll<HTMLElement>('[data-member-menu]')) {
      button.addEventListener('click', () => {
        void read.members().then((members) => {
          const member = members.items.find((each) => each.id === button.dataset.memberMenu)
          if (member) {
            openMenu(button, member)
          }
        })
      })
    }
  }
}
