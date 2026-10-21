import { type AccessSystem, governanceRead, governanceWrite, type HistoryEvent } from '@/api/governance'
import { read } from '@/api/requests'
import { parseCsv } from '@/lib/csv'
import { inventoryRows, SKIP_LABEL } from '@/lib/governance'
import { type Html, html } from '@/lib/html'

import { openFormDialog, openNotice } from './dialog'
import { selectField } from './select'
import { toast } from './toast'

/**
 * The catalog's tools beyond editing it (ADR-0024): opening a review now, reading a system's history,
 * and loading the inventory of access held before go-live.
 */
const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

/** What each recorded change to a system or a profile means, in the screen's words. */
const ACTION_LABEL: Record<string, string> = {
  created: 'criou',
  updated: 'alterou',
  staff_added: 'nomeou responsável',
  staff_removed: 'tirou responsável'
}

export const openReviewDialog = (system: AccessSystem): void =>
  openFormDialog({
    title: `Abrir revisão — ${system.name}`,
    submit: 'Abrir revisão',
    done: 'Revisão aberta. Ela está na aba Revisões.',
    fields: selectField({
      name: 'privilege',
      label: 'Perfis',
      options: [
        { value: 'privileged', label: 'Privilegiados (trimestral)' },
        { value: 'standard', label: 'Padrão (semestral)' }
      ],
      value: 'privileged'
    }),
    onSubmit: (data) =>
      governanceWrite.openReview(system.id, data.get('privilege') === 'standard' ? 'standard' : 'privileged')
  })

const historyItem = (event: HistoryEvent, names: Map<string, string>): Html => html`
  <li>
    <time class="muted">${WHEN.format(new Date(event.occurredAt))}</time>
    <strong>${names.get(event.actorId) ?? 'Alguém'}</strong> ${ACTION_LABEL[event.action] ?? event.action}
    ${event.entityType === 'access_profile' ? 'um perfil' : 'o sistema'}:
    <span class="muted">${Object.entries(event.changes)
      .map(([field, change]) => `${field} ${String(change.before ?? '—')} → ${String(change.after ?? '—')}`)
      .join('; ')}</span>
  </li>
`

export const openHistory = async (system: AccessSystem): Promise<void> => {
  const [history, members] = await Promise.all([governanceRead.history(system.id), read.members()])
  const names = new Map(members.items.map((member) => [member.id, member.name]))
  openNotice(
    `Histórico — ${system.name}`,
    history.items.length
      ? html`<ol class="trail history-list">${history.items.map((event) => historyItem(event, names))}</ol>`
      : html`<p class="muted">Nada registrado ainda.</p>`
  )
}

/** Pasted from a spreadsheet: a header row, then one row per access held today. */
export const openImport = (): void =>
  openFormDialog({
    title: 'Importar inventário de acessos',
    submit: 'Importar',
    done: 'Importação concluída.',
    fields: html`
      <div class="field">
        <label for="field-inventory">Cole a planilha (CSV)</label>
        <textarea id="field-inventory" name="inventory" class="input textarea" rows="8" required
          placeholder="email;sistema;perfil;concedido_em;validade;motivo"></textarea>
        <p class="field-hint">Colunas: email, sistema e perfil; opcionais concedido_em, validade (dd/mm/aaaa) e motivo. Sistemas e perfis precisam existir no catálogo. Perfil privilegiado sem validade recebe 90 dias.</p>
      </div>
    `,
    onSubmit: async (data) => {
      const rows = inventoryRows(parseCsv(String(data.get('inventory') ?? '')))
      const result = await governanceWrite.importInventory(rows)
      const skipped = result.skipped.map((each) => `linha ${each.row + 1}: ${SKIP_LABEL[each.reason]}`)
      toast(
        `${result.imported} acessos importados${skipped.length ? `; ${skipped.length} ignorados — ${skipped.join('; ')}` : ''}.`
      )
    }
  })
