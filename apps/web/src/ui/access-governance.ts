import {
  type AccessSystem,
  type Entitlement,
  type EntitlementRequest,
  governanceRead,
  governanceWrite
} from '@/api/governance'
import { type Me, read } from '@/api/requests'
import {
  endOfDayInSaoPaulo,
  isLate,
  isOpen,
  KIND_LABEL,
  ORIGIN_LABEL,
  PRIVILEGE_LABEL,
  PRIVILEGED_MAX_DAYS,
  STATUS_LABEL
} from '@/lib/governance'
import { type Html, html } from '@/lib/html'

import { bindDatePickers, dateField } from './date-picker'
import { openFormDialog } from './dialog'
import { icon } from './icons'
import { selectField } from './select'

/**
 * The pieces of access governance (ADR-0024) the screens share: a request as a row with its trail,
 * an entitlement as a row, and the dialogs that ask, decide, carry out and remove.
 */
const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const when = (iso: string) => WHEN.format(new Date(iso))
const DAY = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })
const day = (iso: string) => DAY.format(new Date(iso))

const privilegeBadge = (privilege: keyof typeof PRIVILEGE_LABEL) =>
  privilege === 'privileged' ? html`<span class="badge badge-warn">${PRIVILEGE_LABEL.privileged}</span>` : ''

/** A multi-line field; the dialog's `FormData` reads it like any input. */
const areaField = (options: {
  name: string
  label: string
  hint?: string
  required?: boolean
  minLength?: number
}) => html`
  <div class="field">
    <label for="field-${options.name}">${options.label}</label>
    <textarea id="field-${options.name}" name="${options.name}" class="input textarea" rows="3" maxlength="1000"
      ${options.required ? html`required` : ''} ${options.minLength ? html`minlength="${options.minLength}"` : ''}></textarea>
    ${options.hint ? html`<p class="field-hint">${options.hint}</p>` : ''}
  </div>
`

/** Who did what, when — the trail ISO 27001 5.18 asks for, read off the request itself. */
const trail = (request: EntitlementRequest): Html => html`
  <ol class="trail">
    <li><span class="muted">Pedido por</span> ${request.requester.name} <time class="muted">${when(request.createdAt)}</time></li>
    ${request.decided ? html`<li><span class="muted">${request.status === 'declined' ? 'Recusado' : 'Aprovado'} por</span> ${request.decided.by.name} <time class="muted">${when(request.decided.at)}</time>${request.decided.note ? html` — “${request.decided.note}”` : ''}</li>` : ''}
    ${request.completed ? html`<li><span class="muted">Executado por</span> ${request.completed.by.name} <time class="muted">${when(request.completed.at)}</time>${request.completed.evidence ? ` — ${request.completed.evidence}` : ''}</li>` : ''}
  </ol>
`

const requestActions = (request: EntitlementRequest): Html => html`
  <div class="request-actions">
    ${request.canDecide ? html`<button type="button" class="button button-primary" data-approve="${request.id}">Aprovar</button><button type="button" class="button button-secondary" data-decline="${request.id}">Recusar</button>` : ''}
    ${request.canComplete ? html`<button type="button" class="button button-primary" data-complete="${request.id}">${icon('circleCheck', 16)}Concluir</button>` : ''}
    ${request.canCancel ? html`<button type="button" class="button button-ghost" data-cancel="${request.id}">Cancelar pedido</button>` : ''}
  </div>
`

/** The deadline, and whether it was missed — the SLA, on the request itself (ADR-0024). */
const deadline = (request: EntitlementRequest): Html | string => {
  if (!request.dueAt) {
    return ''
  }
  const late = isLate(request, new Date())
  return html`<p class="access-due ${late ? 'is-late' : ''}">${late ? html`<span class="badge badge-danger">Atrasado</span>` : ''}Prazo ${when(request.dueAt)}</p>`
}

/** A person's reason, or — when the platform opened it — why it did. */
const why = (request: EntitlementRequest): Html =>
  request.origin === 'request'
    ? html`<p class="access-reason">${request.reason}</p>`
    : html`<p class="access-reason"><span class="badge">${ORIGIN_LABEL[request.origin]}</span> ${request.reason}</p>`

export const requestRow = (request: EntitlementRequest): Html => html`
  <li class="access-row ${isOpen(request) ? '' : 'is-closed'}">
    <div class="access-row-head">
      <span class="badge">${KIND_LABEL[request.kind]}</span>
      <strong>${request.system.name} · ${request.profile.name}</strong>${privilegeBadge(request.profile.privilege)}
      <span class="access-status status-${request.status}">${STATUS_LABEL[request.status]}</span>
    </div>
    <p class="access-row-who">Para <strong>${request.beneficiary.name}</strong>${request.expiresAt ? html` · até ${day(request.expiresAt)}` : ''}</p>
    ${why(request)}
    ${deadline(request)}
    ${trail(request)}
    ${requestActions(request)}
  </li>
`

export const entitlementRow = (entitlement: Entitlement, options: { showMember: boolean; canRemove: boolean }) => html`
  <li class="access-row">
    <div class="access-row-head">
      <strong>${entitlement.system.name} · ${entitlement.profile.name}</strong>${privilegeBadge(entitlement.profile.privilege)}
    </div>
    <p class="access-row-who">
      ${options.showMember ? html`<strong>${entitlement.member.name}</strong> · ` : ''}desde ${day(entitlement.grantedAt)}${entitlement.expiresAt ? html` · até ${day(entitlement.expiresAt)}` : ''}
    </p>
    <p class="access-reason muted">${entitlement.grantReason || ORIGIN_LABEL[entitlement.grantOrigin]}</p>
    ${options.canRemove ? html`<div class="request-actions"><button type="button" class="button button-ghost" data-remove="${entitlement.id}">Pedir remoção</button></div>` : ''}
  </li>
`

const profileOptions = (systems: readonly AccessSystem[]) =>
  systems
    .filter((system) => !system.archived)
    .flatMap((system) =>
      system.profiles
        .filter((profile) => !profile.archived)
        .map((profile) => ({
          value: profile.id,
          label: `${system.name} — ${profile.name}${profile.privilege === 'privileged' ? ' (privilegiado)' : ''}`
        }))
    )

/** Asking for a profile — for oneself, or for someone of a group one owns (the server decides). */
export const openAskAccess = async (me: Me): Promise<void> => {
  const [systems, members] = await Promise.all([governanceRead.systems(), read.members()])
  const people = members.items
    .filter((member) => member.kind === 'person' && member.status === 'active' && member.id !== me.id)
    .map((member) => ({ value: member.id, label: member.name }))
  openFormDialog({
    title: 'Pedir acesso',
    submit: 'Enviar pedido',
    done: 'Pedido enviado. Está na fila dos donos do sistema.',
    fields: html`
      ${selectField({ name: 'profileId', label: 'Sistema e perfil', options: profileOptions(systems.items), placeholder: 'Escolha um perfil' })}
      ${selectField({ name: 'beneficiaryId', label: 'Para quem', options: [{ value: me.id, label: 'Para mim' }, ...people], value: me.id })}
      ${areaField({ name: 'reason', label: 'Motivo', required: true, minLength: 10, hint: 'Por que precisa deste acesso. Fica registrado no histórico.' })}
      ${dateField({ name: 'expiresAt', label: 'Válido até' })}
      <p class="field-hint">Obrigatório para perfil privilegiado, no máximo ${PRIVILEGED_MAX_DAYS} dias.</p>
    `,
    onOpen: (dialog) => bindDatePickers(dialog),
    onSubmit: async (data) => {
      const profileId = String(data.get('profileId') ?? '')
      if (!profileId) {
        throw { error: { code: 'VALIDATION_FAILED', message: 'Choose a profile' } }
      }
      const expires = String(data.get('expiresAt') ?? '')
      await governanceWrite.askGrant({
        profileId,
        beneficiaryId: String(data.get('beneficiaryId') || me.id),
        reason: String(data.get('reason')).trim(),
        ...(expires ? { expiresAt: endOfDayInSaoPaulo(expires) } : {})
      })
    }
  })
}

export const openRemoval = (entitlement: Entitlement): void =>
  openFormDialog({
    title: `Pedir remoção — ${entitlement.system.name} · ${entitlement.profile.name}`,
    submit: 'Pedir remoção',
    done: 'Remoção pedida. Está na fila dos operadores do sistema.',
    fields: areaField({ name: 'reason', label: 'Motivo', required: true, minLength: 10 }),
    onSubmit: (data) => governanceWrite.askRemoval(entitlement.id, String(data.get('reason')).trim())
  })

export const openDecision = (requestId: string, approve: boolean): void =>
  openFormDialog({
    title: approve ? 'Aprovar pedido' : 'Recusar pedido',
    submit: approve ? 'Aprovar' : 'Recusar',
    done: approve ? 'Aprovado. O pedido foi para os operadores.' : 'Pedido recusado.',
    fields: areaField({ name: 'note', label: approve ? 'Comentário (opcional)' : 'Por que recusar' }),
    onSubmit: (data) => governanceWrite.decide(requestId, approve, String(data.get('note') ?? '').trim())
  })

export const openCompletion = (requestId: string): void =>
  openFormDialog({
    title: 'Concluir pedido',
    submit: 'Concluir',
    done: 'Concluído. O acesso foi registrado.',
    fields: areaField({
      name: 'evidence',
      label: 'Evidência',
      required: true,
      minLength: 3,
      hint: 'O que foi feito no sistema: usuário criado, grupo alterado, chamado aberto…'
    }),
    onSubmit: (data) => governanceWrite.complete(requestId, String(data.get('evidence')).trim())
  })
