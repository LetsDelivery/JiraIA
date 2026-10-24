import { read, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { SPACE_TYPE_LABEL } from '@/lib/space-types'

import { busy, submitButton } from './busy'
import { bindSelects } from './select'
import { spaceChanges, spaceFormFields } from './space-dialogs'
import { toast } from './toast'

const row = (label: string, value: string): Html =>
  html`<div class="settings-fact"><dt>${label}</dt><dd>${value}</dd></div>`

/**
 * The space itself, first in its settings: its admins change its name, type, lead, description,
 * sprints and estimate; everyone else reads them. The key never changes — it is in every card's key.
 */
export const generalPanel = async (spaceId: string, manages: boolean): Promise<Html> => {
  const [space, members] = await Promise.all([read.space(spaceId), read.members()])
  const key = row('Chave', `${space.key} — prefixo dos cards e endereço do espaço; não muda.`)
  if (!manages) {
    return html`<dl class="settings-facts">
      ${key}${row('Nome', space.name)}${row('Tipo', SPACE_TYPE_LABEL[space.type])}
      ${row('Líder', space.lead?.name ?? 'Sem líder')}${row('Descrição', space.description || '—')}
      ${row('Sprints', space.usesSprints ? 'Usa sprints' : 'Não usa sprints')}
      ${row('Estimativa', space.estimation === 'points' ? 'Pontos' : 'P/M/G')}
    </dl>`
  }
  return html`
    <dl class="settings-facts">${key}</dl>
    <form class="stack settings-form" data-space-form>
      ${spaceFormFields(space, members.items)}
      <div><button type="submit" class="button button-primary">Salvar</button></div>
    </form>
  `
}

export const bindGeneralPanel = (root: HTMLElement, spaceId: string): void => {
  const form = root.querySelector<HTMLFormElement>('[data-space-form]')
  if (!form) {
    return
  }
  bindSelects(form)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void busy(submitButton(form), () =>
      write
        .updateSpace(spaceId, spaceChanges(new FormData(form)))
        .then(() => toast('Espaço atualizado.'))
        .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    )
  })
}
