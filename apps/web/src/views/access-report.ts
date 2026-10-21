import { type AccessReport, governanceRead } from '@/api/governance'
import { downloadCsv } from '@/lib/csv'
import { todayInSaoPaulo } from '@/lib/dates'
import { KIND_LABEL, ORIGIN_LABEL, PRIVILEGE_LABEL, quarterOf, STATUS_LABEL } from '@/lib/governance'
import { type Html, html } from '@/lib/html'
import { icon } from '@/ui/icons'

import { on } from './access-systems'

/**
 * What an auditor takes away (ADR-0024, ISO 27001 5.18 and 27701): per system, who holds what, how
 * much is privileged, whether it holds personal data, and how the SLAs were met — on screen and as
 * CSV, with every entitlement and every request behind it.
 */
const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const when = (iso: string | null | undefined) => (iso ? WHEN.format(new Date(iso)) : '')
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)

/** The current quarter: what an auditor asks first. */
const period = quarterOf(todayInSaoPaulo())

const reportRow = (row: AccessReport['items'][number]): Html => html`
  <li class="access-row">
    <div class="access-row-head">
      <strong>${row.system.name}</strong>
      ${row.holdsPersonalData ? html`<span class="badge badge-warn">Dado pessoal</span>` : ''}
      <span class="access-status ${row.compliance !== null && row.compliance < 1 ? 'status-requested' : 'status-done'}">SLA ${percent(row.compliance)}</span>
    </div>
    <p class="access-row-who">${row.held} acessos vigentes · ${row.privilegedHeld} privilegiados</p>
    <p class="access-row-who">${row.done} pedidos concluídos no período · ${row.onTime} no prazo · ${row.openLate} em aberto e atrasados</p>
  </li>
`

export const reportSection = async (): Promise<Html> => {
  const report = await governanceRead.report(period.from, period.to)
  return html`
    <div class="row access-intro">
      <p class="muted">Período de ${period.from.split('-').reverse().join('/')} a ${period.to.split('-').reverse().join('/')} — trimestre atual. Importações do inventário não contam no SLA.</p>
      <span class="request-actions">
        <button type="button" class="button button-secondary" data-export="report">${icon('download', 16)}Relatório</button>
        <button type="button" class="button button-secondary" data-export="entitlements">${icon('download', 16)}Acessos</button>
        <button type="button" class="button button-secondary" data-export="requests">${icon('download', 16)}Pedidos</button>
      </span>
    </div>
    ${report.items.length ? html`<ul class="access-list">${report.items.map(reportRow)}</ul>` : html`<p class="muted">Nenhum sistema para mostrar.</p>`}
  `
}

const exportReport = async () => {
  const report = await governanceRead.report(period.from, period.to)
  downloadCsv(`acessos-sla-${period.from}-${period.to}.csv`, [
    ['sistema', 'dado_pessoal', 'vigentes', 'privilegiados', 'concluidos', 'no_prazo', 'abertos_atrasados', 'sla'],
    ...report.items.map((row) => [
      row.system.name,
      row.holdsPersonalData ? 'sim' : 'não',
      String(row.held),
      String(row.privilegedHeld),
      String(row.done),
      String(row.onTime),
      String(row.openLate),
      percent(row.compliance)
    ])
  ])
}

const exportEntitlements = async () => {
  const [all, systems] = await Promise.all([governanceRead.allEntitlements(), governanceRead.systems()])
  const personal = new Set(systems.items.filter((each) => each.holdsPersonalData).map((each) => each.id))
  downloadCsv(`acessos-${todayInSaoPaulo()}.csv`, [
    [
      'pessoa',
      'email',
      'sistema',
      'perfil',
      'nivel',
      'dado_pessoal',
      'concedido_em',
      'validade',
      'removido_em',
      'motivo'
    ],
    ...all.items.map((each) => [
      each.member.name,
      each.member.email ?? '',
      each.system.name,
      each.profile.name,
      PRIVILEGE_LABEL[each.profile.privilege],
      personal.has(each.system.id) ? 'sim' : 'não',
      when(each.grantedAt),
      when(each.expiresAt),
      when(each.removedAt),
      each.grantReason || ORIGIN_LABEL[each.grantOrigin]
    ])
  ])
}

const exportRequests = async () => {
  const requests = await governanceRead.requests()
  downloadCsv(`pedidos-de-acesso-${todayInSaoPaulo()}.csv`, [
    [
      'tipo',
      'origem',
      'situacao',
      'sistema',
      'perfil',
      'para',
      'pedido_por',
      'pedido_em',
      'motivo',
      'aprovado_por',
      'aprovado_em',
      'executado_por',
      'executado_em',
      'evidencia',
      'prazo',
      'atrasado'
    ],
    ...requests.items.map((each) => [
      KIND_LABEL[each.kind],
      ORIGIN_LABEL[each.origin],
      STATUS_LABEL[each.status],
      each.system.name,
      each.profile.name,
      each.beneficiary.name,
      each.requester.name,
      when(each.createdAt),
      each.reason || ORIGIN_LABEL[each.origin],
      each.decided?.by.name ?? '',
      when(each.decided?.at),
      each.completed?.by.name ?? '',
      when(each.completed?.at),
      each.completed?.evidence ?? '',
      when(each.dueAt),
      each.overdue ? 'sim' : 'não'
    ])
  ])
}

const EXPORTS: Record<string, () => Promise<void>> = {
  report: exportReport,
  entitlements: exportEntitlements,
  requests: exportRequests
}

export const bindReport = (root: HTMLElement): void => {
  on(root, 'export', (button) => EXPORTS[button.dataset.export ?? '']?.() ?? Promise.resolve())
}
