import { accessRead } from '@/api/access'
import { read, type Space, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { spacePath } from '@/lib/space-types'
import { persistedStore } from '@/lib/store'

import { openFormDialog, textField } from './dialog'
import { bindSelects, selectField } from './select'
import { toast } from './toast'

/**
 * "Criar" in JiraIA's header, as Jira's: a new card from anywhere, in any space the person edits. It
 * starts in the space on screen, or the one used last, and opens the card once it exists.
 */
const lastSpace = persistedStore<string | null>('jiraia.create.space', null)

/** The spaces the caller edits — every space is read by all of LET’S, only some are written (ADR-0012). */
const writable = async (): Promise<Space[]> => {
  const spaces = (await read.spaces()).items
  const access = await Promise.all(spaces.map((space) => accessRead.mine('jiraia', space.id)))
  return spaces.filter((_, index) => access[index]?.canWrite)
}

/** The space on screen, when the address is one of its pages. */
const spaceOnScreen = (spaces: readonly Space[]): Space | undefined => {
  const key = /^\/espacos\/([^/?]+)/.exec(location.pathname)?.[1]
  return spaces.find((space) => space.key === key?.toUpperCase())
}

const typeField = async (spaceId: string): Promise<Html> => {
  const { types } = await read.workflow(spaceId)
  const options = types.map((type) => ({ value: type.id, label: type.name }))
  return selectField({ name: 'typeId', label: 'Tipo', options, value: types[0]?.id ?? '' })
}

/** Choosing another space swaps the types for that space's own. */
const onSpaceChange = (dialog: HTMLDialogElement) => {
  dialog.querySelector('[data-space-field]')?.addEventListener('select-change', (event) => {
    const spaceId = (event as CustomEvent<{ value: string }>).detail.value
    const host = dialog.querySelector<HTMLElement>('[data-type-host]')
    void typeField(spaceId).then((field) => {
      if (host) {
        host.innerHTML = field.value
        bindSelects(host)
      }
    })
  })
}

const submit = async (data: FormData, spaces: readonly Space[]) => {
  const space = spaces.find((each) => each.id === data.get('spaceId'))
  if (!space) {
    throw { error: { code: 'VALIDATION_FAILED', message: 'Choose a space' } }
  }
  const typeId = String(data.get('typeId') ?? '')
  const card = await write.createCard(space.id, {
    title: String(data.get('title')).trim(),
    ...(typeId ? { typeId } : {})
  })
  lastSpace.set(space.id)
  navigate(`${spacePath(space.key)}?card=${card.key}`)
}

export const openCreateCard = async (): Promise<void> => {
  const spaces = await writable().catch((refusal: unknown) => {
    toast(refusalSentence(refusal), 'error')
    return []
  })
  if (spaces.length === 0) {
    toast('Você ainda não edita nenhum espaço. Peça acesso em Pessoas e papéis de um espaço.', 'error')
    return
  }
  const chosen = spaceOnScreen(spaces) ?? spaces.find((space) => space.id === lastSpace.get()) ?? spaces[0]
  const options = spaces.map((space) => ({ value: space.id, label: `${space.key} · ${space.name}` }))
  openFormDialog({
    title: 'Criar card',
    submit: 'Criar',
    done: 'Card criado.',
    fields: html`
      ${selectField({ name: 'spaceId', label: 'Espaço', options, value: chosen?.id ?? '', attributes: html`data-space-field` })}
      <div data-type-host>${await typeField(chosen?.id ?? '')}</div>
      ${textField({ name: 'title', label: 'Título', required: true, maxLength: 255 })}
    `,
    onSubmit: (data) => submit(data, spaces),
    onOpen: onSpaceChange
  })
}
