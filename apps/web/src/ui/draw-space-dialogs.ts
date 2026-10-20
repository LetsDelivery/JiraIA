import { type DrawSpace, drawWrite } from '@/api/draw'
import { DRAW_HOME, drawSpacePath } from '@/lib/draw'
import { html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'

import { openFormDialog, textField } from './dialog'
import { toast } from './toast'

const fields = (space?: DrawSpace) => html`
  ${textField({ name: 'icon', label: 'Ícone', maxLength: 8, value: space?.icon ?? '📘', hint: 'Um emoji que represente o espaço.' })}
  ${textField({ name: 'name', label: 'Nome', required: true, maxLength: 80, placeholder: 'Ex.: Produto', ...(space ? { value: space.name } : {}) })}
  ${textField({ name: 'description', label: 'Descrição', maxLength: 500, placeholder: 'Para que serve o espaço', ...(space ? { value: space.description } : {}) })}
`

const values = (data: FormData) => ({
  icon: String(data.get('icon') ?? '').trim() || '📘',
  name: String(data.get('name')).trim(),
  description: String(data.get('description') ?? '').trim()
})

/** A new LET’S Draw AI space, made by whoever needs one (ADR-0011); it opens once made. */
export const openCreateDrawSpace = (): void => {
  openFormDialog({
    title: 'Criar espaço',
    submit: 'Criar espaço',
    done: 'Espaço criado.',
    fields: html`<p class="muted">Um espaço reúne as pastas, páginas e quadros de uma equipe ou assunto. Toda a LET’S pode ver e editar.</p>${fields()}`,
    onSubmit: async (data) => {
      const space = await drawWrite.createSpace(values(data))
      navigate(drawSpacePath(space.id))
    }
  })
}

/** "Configurações do espaço": its name, icon and description — and deleting it, for who manages it. */
export const openDrawSpaceSettings = (space: DrawSpace): void => {
  openFormDialog({
    title: 'Configurações do espaço',
    submit: 'Salvar',
    done: 'Espaço atualizado.',
    fields: html`${fields(space)}
      <div class="danger-zone"><p class="muted">Excluir esconde o espaço e todo o seu conteúdo; o histórico fica guardado.</p>
        <button type="button" class="button button-ghost" data-delete-space>Excluir o espaço</button></div>`,
    onSubmit: async (data) => {
      await drawWrite.updateSpace(space.id, values(data))
    },
    onOpen: (dialog) => {
      dialog.querySelector('[data-delete-space]')?.addEventListener('click', () => {
        if (!confirm(`Excluir o espaço "${space.name}" e todo o seu conteúdo?`)) {
          return
        }
        drawWrite
          .deleteSpace(space.id)
          .then(() => {
            dialog.close()
            dialog.remove()
            toast('Espaço excluído.')
            navigate(DRAW_HOME)
          })
          .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
      })
    }
  })
}
