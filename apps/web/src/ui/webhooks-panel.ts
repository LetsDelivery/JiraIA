import {
  type Delivery,
  outwardRead,
  outwardWrite,
  type Webhook,
  type WebhookEvent,
  type WebhookInput
} from '@/api/outward'
import { type Html, html } from '@/lib/html'
import { DELIVERY_LABEL, deliveryDetail, EVENT_LABEL } from '@/lib/outward'
import { refusalSentence } from '@/lib/refusal'

import { openFormDialog } from './dialog'
import { openEditorDialog } from './editor-dialog'
import { icon } from './icons'
import { showSecretOnce } from './secret-dialog'
import { toast } from './toast'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const EVENTS = Object.keys(EVENT_LABEL) as WebhookEvent[]
const SIGNATURE_HINT =
  'Cada envio leva x-jiraia-signature: t=<segundos>,v1=<HMAC-SHA256 de "t.corpo" com este segredo>. Confira a assinatura e recuse horários antigos.'

const hookCard = (hook: Webhook): Html => html`
  <li class="intake-card" data-webhook="${hook.id}">
    <div class="intake-card-head">
      <div class="intake-card-title">
        <h3>${hook.name}</h3>
        <span class="badge ${hook.enabled ? 'badge-on' : ''}">${hook.enabled ? 'Ligado' : 'Desligado'}</span>
      </div>
      <div class="row">
        <button type="button" class="button button-ghost button-small" data-deliveries aria-expanded="false">${icon('history', 16)}Entregas</button>
        <button type="button" class="button button-ghost button-small" data-rotate>${icon('lock', 16)}Novo segredo</button>
        <button type="button" class="button button-ghost button-icon" data-edit-webhook aria-label="Editar ${hook.name}">${icon('pencil', 16)}</button>
        <button type="button" class="button button-ghost button-icon" data-delete-webhook aria-label="Excluir ${hook.name}">${icon('trash', 16)}</button>
      </div>
    </div>
    <p class="data">${hook.url}</p>
    <p class="intake-card-meta">${hook.events.map((event) => html`<span class="chip">${EVENT_LABEL[event]}</span>`)} · segredo ${hook.secretHint}</p>
    <div class="rule-runs" data-delivery-list hidden></div>
  </li>
`

/**
 * The space's outgoing webhooks (escopo-mvp 4.7), for its admins: where card changes are POSTed,
 * signed; the recent deliveries and their tries; a new secret when the old one may have leaked.
 */
export const webhooksPanel = async (spaceId: string): Promise<Html> => {
  const { items } = await outwardRead.webhooks(spaceId)
  return html`
    <section class="section">
      <div class="section-head">
        <div>
          <h2>Webhooks</h2>
          <p class="muted">Envia as mudanças dos cards deste espaço para outro sistema, assinadas. Se o destino falhar, tenta de novo por até 8 horas.</p>
        </div>
        <button type="button" class="button button-primary" data-new-webhook>${icon('plus', 16)}Novo webhook</button>
      </div>
      ${
        items.length
          ? html`<ul class="intake-list">${items.map(hookCard)}</ul>`
          : html`<div class="empty"><p class="empty-title">Nenhum webhook</p><p class="muted">Um ERP, um n8n ou uma planilha podem receber cada card movido ou comentado.</p></div>`
      }
    </section>
  `
}

const editorBody = (draft: WebhookInput): Html => html`
  <div class="field"><label for="hook-name">Nome</label><input id="hook-name" class="input" data-hook="name" value="${draft.name}" maxlength="120" required /></div>
  <div class="field"><label for="hook-url">Endereço (https)</label><input id="hook-url" class="input" type="url" data-hook="url" value="${draft.url}" placeholder="https://…" required />
    <p class="field-hint">Só endereços públicos com https; endereços de rede interna são recusados.</p></div>
  <div class="field"><span class="label">Eventos</span>
    <div class="chips" role="group" aria-label="Eventos">
      ${EVENTS.map((event) => html`<button type="button" class="chip chip-toggle" data-hook-event="${event}" aria-pressed="${draft.events.includes(event)}">${EVENT_LABEL[event]}</button>`)}
    </div></div>
  <button type="button" class="chip-toggle align-start" data-hook-enabled aria-pressed="${draft.enabled}">Ligado</button>
`

const _bindEditor = (root: HTMLElement, draft: WebhookInput, redraw: () => void) => {
  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement
    if (input.dataset.hook === 'name' || input.dataset.hook === 'url') {
      draft[input.dataset.hook] = input.value
    }
  })
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const chosen = target.closest<HTMLElement>('[data-hook-event]')?.dataset.hookEvent as WebhookEvent | undefined
    if (chosen) {
      draft.events = draft.events.includes(chosen)
        ? draft.events.filter((each) => each !== chosen)
        : [...draft.events, chosen]
      redraw()
    } else if (target.closest('[data-hook-enabled]')) {
      draft.enabled = !draft.enabled
      redraw()
    }
  })
}

const openEditor = (spaceId: string, hook?: Webhook) => {
  const draft: WebhookInput = {
    name: hook?.name ?? '',
    url: hook?.url ?? '',
    events: hook?.events ?? ['card.moved'],
    enabled: hook?.enabled ?? true
  }
  openEditorDialog({
    title: hook ? `Editar ${hook.name}` : 'Novo webhook',
    submit: hook ? 'Salvar' : 'Criar webhook',
    done: hook ? 'Webhook salvo.' : 'Webhook criado.',
    body: () => editorBody(draft),
    bind: (root, redraw) => _bindEditor(root, draft, redraw),
    onSubmit: async () => {
      if (hook) {
        return await outwardWrite.updateWebhook(hook.id, spaceId, draft)
      }
      const created = await outwardWrite.createWebhook(spaceId, draft)
      showSecretOnce('Segredo do webhook', created.secret, SIGNATURE_HINT)
    }
  })
}

const deliveryItem = (delivery: Delivery): Html => html`
  <li class="run run-${delivery.status === 'delivered' ? 'succeeded' : delivery.status === 'failed' ? 'failed' : 'skipped'}" data-delivery="${delivery.id}">
    <span class="run-status">${DELIVERY_LABEL[delivery.status]}</span>
    <span class="chip">${EVENT_LABEL[delivery.eventType as WebhookEvent] ?? delivery.eventType}</span>
    <span class="muted">${WHEN.format(new Date(delivery.createdAt))} · ${deliveryDetail(delivery)}</span>
    ${delivery.status === 'pending' && delivery.nextAttemptAt ? html`<span class="muted">· próxima às ${WHEN.format(new Date(delivery.nextAttemptAt))}</span>` : ''}
    <button type="button" class="button button-ghost button-small" data-redeliver="${delivery.id}">Reenviar</button>
    ${delivery.lastError ? html`<code class="run-error">${delivery.lastError}</code>` : ''}
  </li>
`

const _showDeliveries = async (card: HTMLElement, button: HTMLElement, webhookId: string) => {
  const list = card.querySelector('[data-delivery-list]') as HTMLElement
  const open = list.hidden || button !== card.querySelector('[data-deliveries]')
  button.setAttribute('aria-expanded', String(open))
  list.hidden = !open
  if (open) {
    const { items } = await outwardRead.deliveries(webhookId)
    list.innerHTML = (
      items.length
        ? html`<ul class="run-list">${items.map(deliveryItem)}</ul>`
        : html`<p class="muted">Nada enviado ainda.</p>`
    ).value
  }
}

const _act = async (target: HTMLElement, spaceId: string) => {
  const card = target.closest<HTMLElement>('[data-webhook]')
  const hook = (await outwardRead.webhooks(spaceId)).items.find((each) => each.id === card?.dataset.webhook)
  if (!card || !hook) {
    return
  }
  const redeliver = target.closest<HTMLElement>('[data-redeliver]')?.dataset.redeliver
  if (redeliver) {
    await outwardWrite.redeliver(hook.id, redeliver)
    toast('Reenviado.')
    await _showDeliveries(card, card.querySelector('[data-deliveries]') as HTMLElement, hook.id)
  } else if (target.closest('[data-deliveries]')) {
    await _showDeliveries(card, target.closest('[data-deliveries]') as HTMLElement, hook.id)
  } else if (target.closest('[data-rotate]')) {
    const rotated = await outwardWrite.rotateWebhook(hook.id, spaceId)
    showSecretOnce('Novo segredo do webhook', rotated.secret, `O anterior parou de valer agora. ${SIGNATURE_HINT}`)
  } else if (target.closest('[data-edit-webhook]')) {
    openEditor(spaceId, hook)
  } else if (target.closest('[data-delete-webhook]')) {
    openFormDialog({
      title: `Excluir ${hook.name}`,
      submit: 'Excluir webhook',
      done: 'Webhook excluído.',
      fields: html`<p class="muted">Os envios param e o histórico de entregas some.</p>`,
      onSubmit: () => outwardWrite.deleteWebhook(hook.id, spaceId)
    })
  }
}

export const bindWebhooksPanel = (root: HTMLElement, spaceId: string): void => {
  const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
  root.querySelector('[data-new-webhook]')?.addEventListener('click', () => openEditor(spaceId))
  root.querySelector('.intake-list')?.addEventListener('click', (event) => {
    void _act(event.target as HTMLElement, spaceId).catch(refuse)
  })
}
