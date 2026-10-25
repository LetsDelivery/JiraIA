import { drawRead } from '@/api/draw'
import { type Member, read } from '@/api/requests'
import { type Collection, wikiRead, wikiWrite } from '@/api/wiki'
import { ancestorsOf } from '@/lib/content-tree'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { ACCESS_OPTIONS, collectionPath, REVIEW_PERIODS, WIKI_HOME, wikiPagePath } from '@/lib/wiki'

import { openFormDialog, textField } from './dialog'
import { bindSelects, type SelectOption, selectField } from './select'
import { toast } from './toast'

const OUTLINES = [
  { value: '', label: 'Página em branco' },
  { value: 'customer', label: 'Ficha de cliente', hint: 'Resumo, operação, combinados, atenção, contatos, links' }
]

/** A personal collection is always personal (ADR-0034); the others choose who reads them. */
const accessField = (collection?: Collection): Html =>
  collection?.access === 'personal'
    ? html``
    : html`${selectField({ name: 'access', label: 'Quem lê', options: ACCESS_OPTIONS, value: collection?.access ?? 'organization' })}
      <p class="field-hint wiki-access-warning" data-access-warning hidden></p>`

const fields = (collection?: Collection) => html`
  ${textField({ name: 'icon', label: 'Ícone', maxLength: 8, value: collection?.icon ?? '📚', hint: 'Um emoji que represente a coleção.' })}
  ${textField({ name: 'name', label: 'Nome', required: true, maxLength: 80, placeholder: 'Ex.: Clientes', ...(collection ? { value: collection.name } : {}) })}
  ${textField({ name: 'description', label: 'Descrição', maxLength: 500, placeholder: 'O que esta coleção guarda', ...(collection ? { value: collection.description } : {}) })}
  ${accessField(collection)}
  ${selectField({ name: 'reviewDays', label: 'Revisar páginas oficiais a cada', options: REVIEW_PERIODS, value: String(collection?.reviewDays ?? 90) })}
  ${selectField({ name: 'outline', label: 'Páginas novas começam como', options: OUTLINES, value: collection?.outline ?? '' })}
`

const accessOf = (data: FormData): { access?: 'organization' | 'restricted' } => {
  const access = ACCESS_OPTIONS.find((option) => option.value === data.get('access'))?.value
  return access ? { access } : {}
}

const values = (data: FormData) => ({
  icon: String(data.get('icon') ?? '').trim() || '📚',
  name: String(data.get('name')).trim(),
  description: String(data.get('description') ?? '').trim(),
  reviewDays: Number(data.get('reviewDays') ?? 90),
  outline: data.get('outline') === 'customer' ? ('customer' as const) : null,
  ...accessOf(data)
})

/** A new collection (ADR-0033, ADR-0034): an organization admin makes it, owns it first and says who reads it. */
export const openCreateCollection = (): void => {
  openFormDialog({
    title: 'Criar coleção',
    submit: 'Criar coleção',
    done: 'Coleção criada.',
    fields: html`<p class="muted">Uma coleção reúne o conhecimento oficial de um assunto. Os donos tornam páginas oficiais e os editores escrevem. Uma coleção restrita só aparece para quem recebe papel nela.</p>${fields()}`,
    onSubmit: async (data) => {
      const created = await wikiWrite.createCollection(values(data))
      navigate(collectionPath(created.id))
    }
  })
}

/** How many people of LET’S read today and would stop: everyone active but those holding a role. */
const losing = async (collection: Collection): Promise<string> => {
  const members = (await read.members()).items.filter((member) => member.status === 'active' && !member.isSystem)
  const lose = Math.max(0, members.length - collection.stats.people)
  const kept = collection.stats.people
  return `Só as pessoas e os grupos com papel na coleção continuarão lendo (${kept} ${kept === 1 ? 'pessoa' : 'pessoas'} hoje). ${lose} ${lose === 1 ? 'pessoa deixa' : 'pessoas deixam'} de ver a coleção e as páginas dela em listas, buscas e e-mails.`
}

/** Going from open to restricted warns, in the dialog, who loses the reading. */
const watchAccess = (dialog: HTMLDialogElement, collection: Collection): void => {
  const warning = dialog.querySelector<HTMLElement>('[data-access-warning]')
  if (!warning || collection.access !== 'organization') {
    return
  }
  void losing(collection).then((text) => {
    warning.textContent = text
  })
  dialog.addEventListener('select-change', (event) => {
    const field = (event.target as HTMLElement).querySelector<HTMLInputElement>('input[name="access"]')
    if (field) {
      warning.hidden = field.value !== 'restricted'
    }
  })
}

const closesCollection = (collection: Collection, data: FormData): boolean =>
  collection.access === 'organization' && data.get('access') === 'restricted'

const deleteCollection = (dialog: HTMLDialogElement, collection: Collection): void => {
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
}

/** "Configurações da coleção": name, access, review period and outline — and deleting it, for its owners. */
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
      if (closesCollection(collection, data)) {
        toast('A coleção agora é restrita: só quem tem papel nela a vê.')
      }
    },
    onOpen: (dialog) => {
      watchAccess(dialog, collection)
      dialog
        .querySelector('[data-delete-collection]')
        ?.addEventListener('click', () => deleteCollection(dialog, collection))
    }
  })
}

type Owned = { contentId: string; collectionId: string; owner: { id: string } }

/** Who answers for the page: any active member of the organization. */
export const openChangeOwner = (page: Owned, members: readonly Member[]): void => {
  const people = members
    .filter((member) => member.status === 'active' && !member.isSystem)
    .map((member) => ({ value: member.id, label: member.name }))
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

const PUBLISH_NOTE = {
  draw: 'A página no Draw continua onde está.',
  personal: 'A página pessoal continua nas suas Privadas.'
} as const

/**
 * "Publicar na Wiki" (W8) and "Publicar numa coleção" (ADR-0034): a Draw page or a personal page, as
 * last saved, copied into a collection the caller edits, as a draft they own. The original stays; the
 * copy opens in the wiki, where the collection's owners make it official.
 */
export const openPublishToWiki = async (
  content: { id: string; title: string },
  from: keyof typeof PUBLISH_NOTE = 'draw'
): Promise<void> => {
  const writable = (await wikiRead.collections()).items.filter((each) => each.canWrite && each.access !== 'personal')
  if (writable.length === 0) {
    toast('Você ainda não edita nenhuma coleção da wiki. Peça a um dono para incluir você.', 'error')
    return
  }
  const options = writable.map((each) => ({ value: each.id, label: `${each.icon} ${each.name}` }))
  openFormDialog({
    title: from === 'draw' ? 'Publicar na Wiki' : 'Publicar numa coleção',
    submit: 'Publicar como rascunho',
    done: 'Página publicada como rascunho.',
    fields: html`<p class="muted">Uma cópia de “${content.title}” vai para a coleção como rascunho, com você como responsável. Os donos da coleção a tornam oficial. ${PUBLISH_NOTE[from]}</p>
      ${selectField({ name: 'collectionId', label: 'Coleção', options, value: options[0]?.value ?? '' })}`,
    onSubmit: async (data) => {
      const collectionId = String(data.get('collectionId'))
      const created = await wikiWrite.publish(collectionId, content.id)
      navigate(wikiPagePath(collectionId, created.id))
    }
  })
}

/** Where a new page may go: the collections the caller writes in, their personal one first. */
const placesFor = async (): Promise<Collection[]> => {
  const [personal, list] = await Promise.all([wikiRead.personal(), wikiRead.collections()])
  return [personal, ...list.items.filter((each) => each.canWrite && each.id !== personal.id)]
}

/** The pages and folders of a collection, indented by depth, under "no primeiro nível". */
const parentOptions = async (collectionId: string): Promise<SelectOption[]> => {
  const nodes = (await drawRead.tree(collectionId)).items.filter((node) => node.kind !== 'whiteboard')
  const indent = (id: string) => '— '.repeat(ancestorsOf(nodes, id).length)
  return [
    { value: '', label: 'No primeiro nível' },
    ...nodes.map((node) => ({ value: node.id, label: `${indent(node.id)}${node.title}` }))
  ]
}

const parentField = (options: readonly SelectOption[], value = ''): Html =>
  html`<div data-parent-host>${selectField({ name: 'parentId', label: 'Dentro de', options, value })}</div>`

/** Choosing another collection lists its pages as the possible parents. */
const watchPlace = (dialog: HTMLDialogElement): void => {
  dialog.addEventListener('select-change', (event) => {
    const field = (event.target as HTMLElement).querySelector<HTMLInputElement>('input[name="collectionId"]')
    const host = dialog.querySelector<HTMLElement>('[data-parent-host]')
    if (!field || !host) {
      return
    }
    void parentOptions(field.value).then((options) => {
      host.outerHTML = parentField(options).value
      bindSelects(dialog)
    })
  })
}

/**
 * "Nova página" (wiki-navegacao.md, "Barra lateral"): asks where — a collection and, if wanted, a page
 * to go under — suggesting the collection open or, outside one, the caller's personal collection.
 */
export const openNewPage = async (suggested?: {
  collectionId?: string | undefined
  parentId?: string | undefined
}): Promise<void> => {
  const places = await placesFor()
  const chosen = places.find((each) => each.id === suggested?.collectionId) ?? places[0]
  const options = places.map((each) => ({
    value: each.id,
    label: `${each.icon} ${each.access === 'personal' ? 'Privadas' : each.name}`
  }))
  const parents = chosen ? await parentOptions(chosen.id) : []
  openFormDialog({
    title: 'Nova página',
    submit: 'Criar página',
    done: 'Página criada.',
    fields: html`${selectField({ name: 'collectionId', label: 'Coleção', options, value: chosen?.id ?? '' })}
      ${parentField(parents, suggested?.parentId ?? '')}`,
    onSubmit: async (data) => {
      const collectionId = String(data.get('collectionId'))
      const parentId = String(data.get('parentId') ?? '')
      const created = await wikiWrite.createPage(collectionId, {
        kind: 'page',
        title: 'Sem título',
        ...(parentId ? { parentId } : {})
      })
      navigate(wikiPagePath(collectionId, created.id))
    },
    onOpen: watchPlace
  })
}
