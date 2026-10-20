import { type ApiToken, outwardWrite } from '@/api/outward'
import { type Html, html } from '@/lib/html'
import { TOKEN_STATE_LABEL, tokenState } from '@/lib/outward'
import { refusalSentence } from '@/lib/refusal'

import { openFormDialog, textField } from './dialog'
import { showSecretOnce } from './secret-dialog'
import { selectField } from './select'
import { toast } from './toast'

const DAY = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })
const date = (iso: string | null, none: string): string => (iso ? DAY.format(new Date(iso)) : none)

const row = (token: ApiToken): Html => {
  const state = tokenState(token, new Date())
  return html`
    <tr class="token-${state}">
      <td><strong>${token.name}</strong></td>
      <td class="data">${token.hint}…</td>
      <td><span class="badge ${state === 'active' ? 'badge-on' : ''}">${TOKEN_STATE_LABEL[state]}</span></td>
      <td class="muted">${date(token.createdAt, '—')}</td>
      <td class="muted">${date(token.lastUsedAt, 'Nunca')}</td>
      <td class="muted">${date(token.expiresAt, 'Sem validade')}</td>
      <td class="actions">${state === 'active' ? html`<button type="button" class="button button-ghost button-small" data-revoke-token="${token.id}">Revogar</button>` : ''}</td>
    </tr>
  `
}

/** A list of tokens: what each is for, its first characters, when it was last used, and revoking it. */
export const tokenTable = (tokens: readonly ApiToken[], empty: string): Html =>
  tokens.length
    ? html`<table class="table people-table token-table">
        <thead><tr><th>Nome</th><th>Começa com</th><th>Situação</th><th>Criado</th><th>Último uso</th><th>Validade</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${tokens.map(row)}</tbody>
      </table>`
    : html`<p class="muted">${empty}</p>`

export const bindTokenTable = (root: HTMLElement): void => {
  root.addEventListener('click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-revoke-token]')?.dataset.revokeToken
    if (id) {
      outwardWrite
        .revokeToken(id)
        .then(() => toast('Token revogado: ele para de funcionar agora.'))
        .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    }
  })
}

const VALIDITY = [
  { value: '', label: 'Sem validade (até revogar)' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: '365', label: '1 ano' }
]

/** Asks a name and a validity, makes the token, and shows its value the one time it can be seen. */
export const openNewToken = (
  title: string,
  create: (name: string, days?: number) => Promise<{ value: string }>
): void =>
  openFormDialog({
    title,
    submit: 'Criar token',
    done: 'Token criado.',
    fields: html`
      ${textField({ name: 'name', label: 'Para que serve', placeholder: 'Rotina de roadmap, n8n, planilha…', required: true, maxLength: 80 })}
      ${selectField({ name: 'days', label: 'Validade', options: VALIDITY, value: '90' })}
    `,
    onSubmit: async (data) => {
      const days = Number(data.get('days')) || undefined
      const { value } = await create(String(data.get('name')).trim(), days)
      showSecretOnce('Seu token', value, 'Use no cabeçalho Authorization: Bearer <token>, nas rotas /v1 da API.')
    }
  })
