import { accessRead, accessWrite, type Product } from '@/api/access'
import { type Html, html } from '@/lib/html'

import { openFormDialog, textField } from './dialog'
import { icon } from './icons'

/**
 * What someone who may only read sees on a space (ADR-0012): that they read it, and how to ask to
 * edit — or that they already asked, and the request is waiting.
 */
export const editNotice = async (product: Product, spaceId: string): Promise<Html> => {
  const [access, mine] = await Promise.all([accessRead.mine(product, spaceId), accessRead.myRequests()])
  if (access.canWrite) {
    return html``
  }
  const waiting = mine.items.some(
    (request) => request.product === product && request.spaceId === spaceId && request.status === 'pending'
  )
  return html`
    <div class="notice" role="status">
      ${icon('lock', 18)}
      ${
        waiting
          ? html`<p>Você pediu para editar este espaço. O pedido está com os administradores dele.</p>`
          : html`<p>Você pode ver tudo aqui. Para editar, peça acesso a quem administra o espaço.</p>
            <button type="button" class="button button-secondary" data-request-access>Solicitar acesso para editar</button>`
      }
    </div>
  `
}

export const bindEditNotice = (root: HTMLElement, product: Product, spaceId: string): void => {
  root.querySelector('[data-request-access]')?.addEventListener('click', () =>
    openFormDialog({
      title: 'Solicitar acesso para editar',
      submit: 'Enviar pedido',
      done: 'Pedido enviado aos administradores do espaço.',
      fields: textField({
        name: 'message',
        label: 'Mensagem (opcional)',
        hint: 'Conte para que você precisa editar.',
        maxLength: 1000
      }),
      onSubmit: (data) => accessWrite.request(product, spaceId, String(data.get('message') ?? '').trim())
    })
  )
}
