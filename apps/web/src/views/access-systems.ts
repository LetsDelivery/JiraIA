import {
  type AccessSystem,
  type Duty,
  governanceRead,
  governanceWrite,
  type Holiday,
  type Privilege
} from '@/api/governance'
import { read } from '@/api/requests'
import { DUTY_LABEL, PRIVILEGE_LABEL } from '@/lib/governance'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { openHistory, openImport, openReviewDialog } from '@/ui/access-catalog-tools'
import { bindDatePickers, dateField } from '@/ui/date-picker'
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

/** Its staff, auditors and admins read a system's history. */
const readsHistory = (system: AccessSystem, auditor: boolean) => auditor || system.canManage || system.duties.length > 0

const systemActions = (system: AccessSystem, auditor: boolean) => html`
  <span class="system-actions">
    ${system.canEditProfiles ? html`<button type="button" class="button button-secondary" data-open-review="${system.id}">${icon('listCheck', 16)}Revisar</button>` : ''}
    ${readsHistory(system, auditor) ? html`<button type="button" class="button button-ghost" data-history="${system.id}">${icon('history', 16)}Histórico</button>` : ''}
    ${system.canEditProfiles ? html`<button type="button" class="button button-secondary" data-new-profile="${system.id}">${icon('plus', 16)}Perfil</button>` : ''}
    ${system.canManage ? html`<button type="button" class="button button-secondary" data-sla="${system.id}">${icon('clock', 16)}Prazos</button>` : ''}
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

/** "1 dia útil", "2 dias úteis". */
const businessDays = (count: number) => (count === 1 ? '1 dia útil' : `${count} dias úteis`)

const systemCard = (system: AccessSystem, auditor: boolean): Html => html`
  <section class="section system-card ${system.archived ? 'is-closed' : ''}">
    <div class="system-head"><h2>${system.name}</h2>${systemBadges(system)}${systemActions(system, auditor)}</div>
    ${system.description ? html`<p class="muted">${system.description}</p>` : ''}
    <p class="muted system-sla">Prazos: conceder em ${businessDays(system.sla.grantDays)} · remover em ${businessDays(system.sla.removalDays)} · desligamento em ${system.sla.departureHours} h</p>
    <div class="system-columns">${profilesColumn(system)}${staffColumn(system)}</div>
  </section>
`

export const systemsSection = async (): Promise<Html> => {
  const [me, systems] = await Promise.all([read.me(), governanceRead.systems()])
  return html`
    <div class="row access-intro">
      <p class="muted">Cada sistema tem perfis. Acesso só existe por um perfil, pedido com motivo.</p>
      ${me.isOrgAdmin ? html`<span class="request-actions"><button type="button" class="button button-secondary" data-new-system>${icon('plus', 16)}Novo sistema</button><button type="button" class="button button-ghost" data-import>${icon('fileUpload', 16)}Importar inventário</button></span>` : ''}
    </div>
    ${systems.items.length ? systems.items.map((system) => systemCard(system, me.isAccessAuditor)) : html`<p class="empty muted">Nenhum sistema no catálogo ainda.</p>`}
    ${await holidaysSection(me.isOrgAdmin)}
  `
}

/** The days the SLAs skip beyond weekends: the organization's own, and the national ones ahead. */
const holidaysSection = async (canEdit: boolean): Promise<Html> => {
  const holidays = (await governanceRead.holidays()).items
  const own = holidays.filter((each) => !each.national)
  const label = (holiday: Holiday) =>
    `${holiday.day.slice(8, 10)}/${holiday.day.slice(5, 7)}/${holiday.day.slice(0, 4)}`
  return html`
    <section class="section system-card">
      <div class="system-head">
        <h2>Calendário dos prazos</h2>
        ${canEdit ? html`<span class="system-actions"><button type="button" class="button button-secondary" data-new-holiday>${icon('plus', 16)}Feriado</button></span>` : ''}
      </div>
      <p class="muted">Prazos contam dias úteis em São Paulo: sem fins de semana, feriados nacionais (${holidays.filter((each) => each.national).length} até o fim do ano que vem) nem os dias abaixo.</p>
      ${
        own.length
          ? html`<ul class="holiday-list">${own.map((holiday) => html`<li class="holiday-item badge">${label(holiday)} · ${holiday.name}${canEdit ? html`<button type="button" class="button button-ghost button-icon" data-remove-holiday="${holiday.day}" aria-label="Tirar ${holiday.name}">${icon('x', 14)}</button>` : ''}</li>`)}</ul>`
          : html`<p class="muted">Nenhum feriado próprio da LET’S cadastrado.</p>`
      }
    </section>
  `
}

const newHoliday = async () =>
  openFormDialog({
    title: 'Novo feriado',
    submit: 'Adicionar',
    done: 'Feriado adicionado ao calendário.',
    fields: html`${dateField({ name: 'day', label: 'Dia' })}
      ${textField({ name: 'name', label: 'Nome', required: true, maxLength: 80, placeholder: 'Aniversário de São Paulo' })}`,
    onOpen: (dialog) => bindDatePickers(dialog),
    onSubmit: async (data) => {
      const day = String(data.get('day') ?? '')
      if (!day) {
        throw { error: { code: 'VALIDATION_FAILED', message: 'Choose a day' } }
      }
      await governanceWrite.putHoliday(day, String(data.get('name')).trim())
    }
  })

const editSla = async (systemId: string) => {
  const system = (await governanceRead.systems()).items.find((each) => each.id === systemId)
  if (!system) {
    return
  }
  openFormDialog({
    title: `Prazos — ${system.name}`,
    submit: 'Salvar',
    done: 'Prazos salvos. Valem para os próximos pedidos.',
    fields: html`
      ${textField({ name: 'grant', label: 'Conceder (dias úteis após a aprovação)', type: 'number', required: true, value: String(system.sla.grantDays) })}
      ${textField({ name: 'removal', label: 'Remover (dias úteis após o pedido)', type: 'number', required: true, value: String(system.sla.removalDays) })}
      ${textField({ name: 'departure', label: 'Desligamento (horas corridas)', type: 'number', required: true, value: String(system.sla.departureHours) })}
    `,
    onSubmit: (data) =>
      governanceWrite.setSla(systemId, {
        grantSlaDays: Number(data.get('grant')),
        removalSlaDays: Number(data.get('removal')),
        departureSlaHours: Number(data.get('departure'))
      })
  })
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

const withSystem = (act: (system: AccessSystem) => unknown) => async (button: HTMLElement) => {
  const id = button.dataset.openReview ?? button.dataset.history ?? ''
  const system = (await governanceRead.systems()).items.find((each) => each.id === id)
  if (system) {
    await act(system)
  }
}

export const bindSystems = (root: HTMLElement): void => {
  on(root, 'open-review', withSystem(openReviewDialog))
  on(root, 'history', withSystem(openHistory))
  on(root, 'import', async () => openImport())
  on(root, 'new-system', newSystem)
  on(root, 'new-profile', (button) => newProfile(button.dataset.newProfile ?? ''))
  on(root, 'staff', (button) => addStaff(button.dataset.staff ?? ''))
  on(root, 'sla', (button) => editSla(button.dataset.sla ?? ''))
  on(root, 'new-holiday', newHoliday)
  on(root, 'remove-holiday', (button) => governanceWrite.removeHoliday(button.dataset.removeHoliday ?? ''))
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
