import { accessWrite } from '@/api/access'
import { type Me, type Member, read, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { openFormDialog, textField } from '@/ui/dialog'
import { toggleFloatingMenu } from '@/ui/floating-menu'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'

import type { View } from './view'

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
  <button type="button" role="menuitem" class="is-danger" data-action="deactivate">${icon('x', 16)}Desativar</button>
`

const badges = (member: Member): Html => html`
  ${member.isOrgAdmin ? html`<span class="badge">admin</span>` : ''}
  ${member.isSpaceManager && !member.isOrgAdmin ? html`<span class="badge" title="Cria espaços no JiraIA">gestor</span>` : ''}
`

const memberRow = (me: Me, member: Member): Html => html`
  <tr>
    <td><span class="person-name">${member.name}${badges(member)}</span></td>
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
  title: 'Pessoas',
  render: async () => {
    const [me, members] = await Promise.all([read.me(), read.members()])

    return html`
      <header class="page-header row">
        <h1>Pessoas</h1>
        ${me.isOrgAdmin ? html`<button type="button" class="button button-primary" data-invite>${icon('plus')}Convidar pessoa</button>` : ''}
      </header>
      <table class="table people-table">
        <thead><tr><th>Nome</th><th>Cargo</th><th>E-mail</th><th>Status</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>
          ${members.items.filter((member) => member.kind === 'person').map((member) => memberRow(me, member))}
        </tbody>
      </table>
    `
  },
  bind: (root) => {
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
