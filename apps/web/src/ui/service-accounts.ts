import { outwardRead, outwardWrite, type ServiceAccount } from '@/api/outward'
import { type Html, html } from '@/lib/html'

import { openFormDialog, textField } from './dialog'
import { icon } from './icons'
import { bindTokenTable, openNewToken, tokenTable } from './token-table'

const account = (each: ServiceAccount): Html => html`
  <li class="intake-card" data-account="${each.id}">
    <div class="intake-card-head">
      <div class="intake-card-title"><h3>${each.name}</h3><span class="badge">Conta de serviço</span></div>
      <button type="button" class="button button-secondary button-small" data-account-token>${icon('plus', 16)}Novo token</button>
    </div>
    <p class="muted">Age com os papéis que receber em <strong>Pessoas e papéis</strong> de cada espaço — como uma pessoa.</p>
    ${tokenTable(each.tokens, 'Nenhum token ainda.')}
  </li>
`

/**
 * Service accounts (escopo-mvp 4.8, ADR-0015): integrations that are not a person — an n8n flow, the
 * MCP of Etapa 6 — with roles of their own and tokens that act as them. Organization admins only.
 */
export const serviceAccountsSection = async (): Promise<Html> => {
  const { items } = await outwardRead.serviceAccounts()
  return html`
    <section class="section" data-service-accounts>
      <div class="section-head">
        <div>
          <h2>Contas de serviço</h2>
          <p class="muted">Para integrações que não são uma pessoa. Dê a elas papéis nos espaços e crie tokens para a API.</p>
        </div>
        <button type="button" class="button button-primary" data-new-account>${icon('plus', 16)}Nova conta de serviço</button>
      </div>
      ${items.length ? html`<ul class="intake-list">${items.map(account)}</ul>` : html`<p class="muted">Nenhuma conta de serviço ainda.</p>`}
    </section>
  `
}

export const bindServiceAccounts = (root: HTMLElement): void => {
  const section = root.querySelector<HTMLElement>('[data-service-accounts]')
  if (!section) {
    return
  }
  section.querySelector('[data-new-account]')?.addEventListener('click', () =>
    openFormDialog({
      title: 'Nova conta de serviço',
      submit: 'Criar conta',
      done: 'Conta criada. Dê papéis a ela em Pessoas e papéis dos espaços.',
      fields: textField({
        name: 'name',
        label: 'Nome',
        placeholder: 'Rotina de roadmap',
        required: true,
        maxLength: 80
      }),
      onSubmit: (data) => outwardWrite.createServiceAccount(String(data.get('name')).trim())
    })
  )
  section.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const memberId = target.closest<HTMLElement>('[data-account]')?.dataset.account
    if (memberId && target.closest('[data-account-token]')) {
      openNewToken('Novo token da conta de serviço', (name, days) =>
        outwardWrite.createServiceToken(memberId, name, days)
      )
    }
  })
  bindTokenTable(section)
}
