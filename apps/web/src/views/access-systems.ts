import { type AccessSystem, type Duty, governanceRead, governanceWrite, type Privilege } from '@/api/governance'
import { read } from '@/api/requests'
import { DUTY_LABEL, PRIVILEGE_LABEL } from '@/lib/governance'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { openFormDialog, textField } from '@/ui/dialog'
import { icon } from '@/ui/icons'
import { selectField } from '@/ui/select'
import { toast } from '@/ui/toast'

/**
 * The catalog of access governance (ADR-0024): every LET’S system access is granted to, who answers
 * for it, and its profiles. Everyone sees it — it is what they ask from. An organization admin adds
 * systems and names their staff; an owner keeps the profiles.
 */
const staffItem = (system: AccessSystem, person: AccessSystem['staff'][number]) => html`
  <li class="staff-item">
    <span>${person.name}</span><span class="badge">${DUTY_LABEL[person.duty]}</span>
    ${system.canManage ? html`<button type="button" class="button button-ghost button-icon" data-unstaff="${system.id}" data-duty="${person.duty}" data-member="${person.id}" aria-label="Tirar ${person.name} de ${DUTY_LABEL[person.duty].toLowerCase()}">${icon('x', 14)}</button>` : ''}
  </li>
`

/** Archive, or bring back — the same button, by what the row is now. */
const archiveButton = (data: string, id: string, archived: boolean) =>
  html`<button type="button" class="button button-ghost" data-${data}="${id}" data-archived="${archived ? '1' : ''}">${archived ? 'Restaurar' : 'Arquivar'}</button>`

const archivedNote = (archived: boolean) => (archived ? html` <span class="muted">(arquivado)</span>` : '')

const privilegeBadge = (privilege: AccessSystem['profiles'][number]['privilege']) =>
  html`<span class="badge ${privilege === 'privileged' ? 'badge-warn' : ''}">${PRIVILEGE_LABEL[privilege]}</span>`

const profileItem = (system: AccessSystem, profile: AccessSystem['profiles'][number]) => html`
  <li class="profile-item ${profile.archived ? 'is-closed' : ''}">
    <span class="profile-name">${profile.name}${archivedNote(profile.archived)}</span>
    ${privilegeBadge(profile.privilege)}
    ${profile.description ? html`<span class="muted profile-description">${profile.description}</span>` : ''}
    ${system.canEditProfiles ? archiveButton('archive-profile', profile.id, profile.archived) : ''}
  </li>
`

const systemBadges = (system: AccessSystem) => html`
  ${system.holdsPersonalData ? html`<span class="badge badge-warn" title="Guarda dado pessoal (ISO 27701)">Dado pessoal</span>` : ''}
  ${system.archived ? html`<span class="badge">Arquivado</span>` : ''}
`

const systemActions = (system: AccessSystem) => html`
  <span class="system-actions">
    ${system.canEditProfiles ? html`<button type="button" class="button button-secondary" data-new-profile="${system.id}">${icon('plus', 16)}Perfil</button>` : ''}
    ${system.canManage ? html`<button type="button" class="button button-secondary" data-staff="${system.id}">${icon('userPlus', 16)}Responsável</button>${archiveButton('archive-system', system.id, system.archived)}` : ''}
  </span>
`

const profilesColumn = (system: AccessSystem) => html`
  <div>
    <h3 class="group-column-title">Perfis</h3>
    ${system.profiles.length ? html`<ul class="profile-list">${system.profiles.map((profile) => profileItem(system, profile))}</ul>` : html`<p class="muted">Nenhum perfil ainda. Sem perfil, ninguém pode pedir acesso.</p>`}
  </div>
`

const staffColumn = (system: AccessSystem) => html`
  <div>
    <h3 class="group-column-title">Responsáveis</h3>
    ${system.staff.length ? html`<ul class="staff-list">${system.staff.map((person) => staffItem(system, person))}</ul>` : html`<p class="muted">Ninguém ainda. O dono aprova; o operador executa.</p>`}
  </div>
`

const systemCard = (system: AccessSystem): Html => html`
  <section class="section system-card ${system.archived ? 'is-closed' : ''}">
    <div class="system-head"><h2>${system.name}</h2>${systemBadges(system)}${systemActions(system)}</div>
    ${system.description ? html`<p class="muted">${system.description}</p>` : ''}
    <div class="system-columns">${profilesColumn(system)}${staffColumn(system)}</div>
  </section>
`

export const systemsSection = async (): Promise<Html> => {
  const [me, systems] = await Promise.all([read.me(), governanceRead.systems()])
  return html`
    <div class="row access-intro">
      <p class="muted">Cada sistema tem perfis. Acesso só existe por um perfil, pedido com motivo.</p>
      ${me.isOrgAdmin ? html`<button type="button" class="button button-secondary" data-new-system>${icon('plus', 16)}Novo sistema</button>` : ''}
    </div>
    ${systems.items.length ? systems.items.map(systemCard) : html`<p class="empty muted">Nenhum sistema no catálogo ainda.</p>`}
  `
}

const PRIVILEGES: readonly { value: Privilege; label: string }[] = [
  { value: 'standard', label: 'Padrão' },
  { value: 'privileged', label: 'Privilegiado — administra o sistema; vence em até 90 dias' }
]

const newSystem = async () =>
  openFormDialog({
    title: 'Novo sistema',
    submit: 'Criar',
    done: 'Sistema criado. Agora nomeie o dono e o operador.',
    fields: html`
      ${textField({ name: 'name', label: 'Nome', required: true, maxLength: 80, placeholder: 'AWS' })}
      ${textField({ name: 'description', label: 'Descrição', maxLength: 500 })}
      ${selectField({
        name: 'personal',
        label: 'Guarda dado pessoal?',
        options: [
          { value: 'no', label: 'Não' },
          { value: 'yes', label: 'Sim (ISO 27701)' }
        ],
        value: 'no'
      })}
    `,
    onSubmit: (data) =>
      governanceWrite.createSystem({
        name: String(data.get('name')).trim(),
        description: String(data.get('description')).trim(),
        holdsPersonalData: data.get('personal') === 'yes'
      })
  })

const newProfile = async (systemId: string) =>
  openFormDialog({
    title: 'Novo perfil',
    submit: 'Criar',
    done: 'Perfil criado.',
    fields: html`
      ${textField({ name: 'name', label: 'Nome', required: true, maxLength: 80, placeholder: 'Leitura produção' })}
      ${textField({ name: 'description', label: 'O que ele dá', maxLength: 500 })}
      ${selectField({ name: 'privilege', label: 'Nível', options: PRIVILEGES, value: 'standard' })}
    `,
    onSubmit: (data) =>
      governanceWrite.createProfile(systemId, {
        name: String(data.get('name')).trim(),
        description: String(data.get('description')).trim(),
        privilege: data.get('privilege') === 'privileged' ? 'privileged' : 'standard'
      })
  })

const DUTIES: readonly { value: Duty; label: string }[] = [
  { value: 'owner', label: 'Dono — aprova os pedidos' },
  { value: 'operator', label: 'Operador — executa no sistema' }
]

const addStaff = async (systemId: string) => {
  const members = await read.members()
  const people = members.items
    .filter((member) => member.kind === 'person' && member.status === 'active')
    .map((member) => ({ value: member.id, label: `${member.name} — ${member.email ?? ''}` }))
  openFormDialog({
    title: 'Adicionar responsável',
    submit: 'Adicionar',
    done: 'Responsável adicionado.',
    fields: html`${selectField({ name: 'memberId', label: 'Pessoa', options: people })}
      ${selectField({ name: 'duty', label: 'Papel', options: DUTIES, value: 'owner' })}`,
    onSubmit: async (data) => {
      const memberId = String(data.get('memberId') ?? '')
      if (!memberId) {
        throw { error: { code: 'VALIDATION_FAILED', message: 'Choose a person' } }
      }
      await governanceWrite.putStaff(systemId, data.get('duty') === 'operator' ? 'operator' : 'owner', memberId)
    }
  })
}

export const bindSystems = (root: HTMLElement): void => {
  on(root, 'new-system', newSystem)
  on(root, 'new-profile', (button) => newProfile(button.dataset.newProfile ?? ''))
  on(root, 'staff', (button) => addStaff(button.dataset.staff ?? ''))
  on(root, 'unstaff', (button) =>
    governanceWrite.removeStaff(
      button.dataset.unstaff ?? '',
      button.dataset.duty === 'operator' ? 'operator' : 'owner',
      button.dataset.member ?? ''
    )
  )
  on(root, 'archive-system', (button) =>
    governanceWrite.archiveSystem(button.dataset.archiveSystem ?? '', !button.dataset.archived)
  )
  on(root, 'archive-profile', (button) =>
    governanceWrite.archiveProfile(button.dataset.archiveProfile ?? '', !button.dataset.archived)
  )
}

/** A click on every `[data-<name>]`, with a refusal shown in the words of the screen. */
export const on = (root: HTMLElement, name: string, act: (button: HTMLElement) => Promise<unknown>) => {
  for (const button of root.querySelectorAll<HTMLElement>(`[data-${name}]`)) {
    button.addEventListener('click', () => {
      act(button).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    })
  }
}
