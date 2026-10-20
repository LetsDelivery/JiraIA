import { type Member, read, type Space, write } from '@/api/requests'
import { html } from '@/lib/html'
import { navigate } from '@/lib/router'
import { SPACE_TYPE_OPTIONS, type SpaceType, spacePath, suggestKey } from '@/lib/space-types'

import { openFormDialog, textField } from './dialog'
import { selectField } from './select'

const leadOptions = (members: readonly Member[]) =>
  members
    .filter((member) => member.status === 'active' && member.kind === 'person')
    .map((member) => ({ value: member.id, label: member.name, hint: member.email ?? '' }))

/** The key follows the name until the person types a key of their own. */
const suggestKeyWhileTyping = (dialog: HTMLDialogElement): void => {
  const name = dialog.querySelector<HTMLInputElement>('input[name="name"]')
  const key = dialog.querySelector<HTMLInputElement>('input[name="key"]')
  let edited = false

  key?.addEventListener('input', () => {
    edited = true
    key.value = key.value.toUpperCase()
  })
  name?.addEventListener('input', () => {
    if (key && !edited) {
      key.value = suggestKey(name.value)
    }
  })
}

/** Creates a space and opens it: whoever creates one is about to set it up. */
export const openCreateSpace = async (): Promise<void> => {
  const [me, members] = await Promise.all([read.me(), read.members()])

  openFormDialog({
    title: 'Novo espaço',
    submit: 'Criar espaço',
    done: 'Espaço criado.',
    fields: html`
      ${textField({ name: 'name', label: 'Nome', required: true, placeholder: 'Ex.: Jurídico' })}
      ${textField({ name: 'key', label: 'Chave', required: true, maxLength: 10, placeholder: 'JUR', hint: 'Prefixo dos cards (JUR-123) e endereço do espaço. Não muda depois.' })}
      ${selectField({ name: 'type', label: 'Tipo', options: SPACE_TYPE_OPTIONS, value: 'business' })}
      ${selectField({ name: 'leadId', label: 'Líder', options: leadOptions(members.items), value: me.id })}
      ${textField({ name: 'description', label: 'Descrição' })}
    `,
    onOpen: suggestKeyWhileTyping,
    onSubmit: async (data) => {
      const space = await write.createSpace({
        key: String(data.get('key')).toUpperCase(),
        name: String(data.get('name')),
        description: String(data.get('description') ?? ''),
        type: String(data.get('type')) as SpaceType,
        leadId: String(data.get('leadId') || me.id)
      })
      navigate(spacePath(space.key))
    }
  })
}

export const openEditSpace = async (space: Space): Promise<void> => {
  const members = await read.members()

  openFormDialog({
    title: `Editar ${space.name}`,
    submit: 'Salvar',
    done: 'Espaço atualizado.',
    fields: html`
      ${textField({ name: 'name', label: 'Nome', required: true, value: space.name })}
      ${selectField({ name: 'type', label: 'Tipo', options: SPACE_TYPE_OPTIONS, value: space.type })}
      ${selectField({ name: 'leadId', label: 'Líder', options: leadOptions(members.items), value: space.lead?.id ?? '', placeholder: 'Sem líder' })}
      ${textField({ name: 'description', label: 'Descrição', value: space.description })}
    `,
    onSubmit: (data) =>
      write.updateSpace(space.id, {
        name: String(data.get('name')),
        description: String(data.get('description') ?? ''),
        type: String(data.get('type')) as SpaceType,
        leadId: String(data.get('leadId')) || null
      })
  })
}
