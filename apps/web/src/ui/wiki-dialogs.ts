import type { Member } from '@/api/requests'
import { type Collection, type WikiPage, wikiWrite } from '@/api/wiki'
import { html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { collectionPath, REVIEW_PERIODS, WIKI_HOME } from '@/lib/wiki'

import { openFormDialog, textField } from './dialog'
import { selectField } from './select'
import { toast } from './toast'

const OUTLINES = [
  { value: '', label: 'Página em branco' },
  { value: 'customer', label: 'Ficha de cliente', hint: 'Resumo, operação, combinados, atenção, contatos, links' }
]

const fields = (collection?: Collection) => html`
  ${textField({ name: 'icon', label: 'Ícone', maxLength: 8, value: collection?.icon ?? '📚', hint: 'Um emoji que represente a coleção.' })}
  ${textField({ name: 'name', label: 'Nome', required: true, maxLength: 80, placeholder: 'Ex.: Clientes', ...(collection ? { value: collection.name } : {}) })}
  ${textField({ name: 'description', label: 'Descrição', maxLength: 500, placeholder: 'O que esta coleção guarda', ...(collection ? { value: collection.description } : {}) })}
  ${selectField({ name: 'reviewDays', label: 'Revisar páginas oficiais a cada', options: REVIEW_PERIODS, value: String(collection?.reviewDays ?? 90) })}
  ${selectField({ name: 'outline', label: 'Páginas novas começam como', options: OUTLINES, value: collection?.outline ?? '' })}
`

const values = (data: FormData) => ({
  icon: String(data.get('icon') ?? '').trim() || '📚',
  name: String(data.get('name')).trim(),
  description: String(data.get('description') ?? '').trim(),
  reviewDays: Number(data.get('reviewDays') ?? 90),
  outline: data.get('outline') === 'customer' ? ('customer' as const) : null
})

/** A new collection (ADR-0033): an organization admin makes it and owns it first; it opens once made. */
export const openCreateCollection = (): void => {
  openFormDialog({
    title: 'Criar coleção',
    submit: 'Criar coleção',
    done: 'Coleção criada.',
    fields: html`<p class="muted">Uma coleção reúne o conhecimento oficial de um assunto. Toda a LET’S lê; os donos tornam páginas oficiais e os editores escrevem.</p>${fields()}`,
    onSubmit: async (data) => {
      const created = await wikiWrite.createCollection(values(data))
      navigate(collectionPath(created.id))
    }
  })
}

/** "Configurações da coleção": its name, review period and outline — and deleting it, for its owners. */
export const openCollectionSettings = (collection: Collection): void => {
  openFormDialog({
    title: 'Configurações da coleção',
    submit: 'Salvar',
    done: 'Coleção atualizada.',
    fields: html`${fields(collection)}
      <p class="muted">Um prazo novo vale a partir da próxima revisão de cada página.</p>
      <div class="danger-zone"><p class="muted">Excluir esconde a coleção e todas as suas páginas; o histórico fica guardado.</p>
        <button type="button" class="button button-ghost" data-delete-collection>Excluir a coleção</button></div>`,
    onSubmit: async (data) => {
      await wikiWrite.updateCollection(collection.id, values(data))
    },
    onOpen: (dialog) => {
      dialog.querySelector('[data-delete-collection]')?.addEventListener('click', () => {
        if (!confirm(`Excluir a coleção "${collection.name}" e todas as suas páginas?`)) {
          return
        }
        wikiWrite
          .deleteCollection(collection.id)
          .then(() => {
            dialog.close()
            dialog.remove()
            toast('Coleção excluída.')
            navigate(WIKI_HOME)
          })
          .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
      })
    }
  })
}

/** Who answers for the page: any active member of the organization. */
export const openChangeOwner = (page: WikiPage, members: readonly Member[]): void => {
  const people = members.map((member) => ({ value: member.id, label: member.name }))
  openFormDialog({
    title: 'Trocar responsável',
    submit: 'Salvar',
    done: 'Responsável atualizado.',
    fields: html`<p class="muted">O responsável responde pelo conteúdo e confirma as revisões da página.</p>
      ${selectField({ name: 'ownerId', label: 'Responsável', options: people, value: page.owner.id })}`,
    onSubmit: async (data) => {
      await wikiWrite.changeOwner(page, String(data.get('ownerId')))
    }
  })
}
