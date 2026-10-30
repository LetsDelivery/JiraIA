import { oauthRead } from '@/api/oauth'
import { outwardRead, outwardWrite } from '@/api/outward'
import { type Me, read, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { toAvatar } from '@/lib/photo'
import { refusalSentence } from '@/lib/refusal'
import { avatar } from '@/ui/avatar'
import { bindConnections, connectionsSection } from '@/ui/connections'
import { openFormDialog, textField } from '@/ui/dialog'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { bindTokenTable, openNewToken, tokenTable } from '@/ui/token-table'

import type { View } from './view'

/** The photo every card and comment shows of them (ADR-0039): chosen here, cropped in the browser. */
const photoField = (me: Me): Html => html`
  <label class="profile-photo-picker">
    ${avatar(me, 'avatar avatar-profile')}
    <span class="profile-photo-overlay" aria-hidden="true">${icon('camera', 20)}${me.avatarUrl ? 'Trocar' : 'Adicionar'}</span>
    <input type="file" class="sr-only" accept="image/*" data-avatar-input aria-label="Escolher foto de perfil" />
  </label>
  ${me.avatarUrl ? html`<button type="button" class="button button-ghost button-small" data-remove-avatar>${icon('trash', 16)}Remover foto</button>` : ''}
`

const changePhoto = async (file: File): Promise<Me> => {
  const photo = await toAvatar(file).catch(() => {
    throw {
      error: {
        code: 'VALIDATION_FAILED',
        message: `File "${file.name}" is not a picture`,
        details: { photo: file.name }
      }
    }
  })
  return await write.setAvatar(photo)
}

/** The photo changes at once, apart from Salvar; the dialog shows the new one in place. */
const bindPhoto = (dialog: HTMLDialogElement): void => {
  const field = dialog.querySelector<HTMLElement>('[data-photo-field]')
  const shown = (done: string) => (me: Me) => {
    if (field) {
      field.innerHTML = photoField(me).value
    }
    toast(done)
  }
  const failed = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
  field?.addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (file) {
      field.classList.add('is-busy')
      changePhoto(file)
        .then(shown('Foto atualizada.'))
        .catch(failed)
        .finally(() => field.classList.remove('is-busy'))
    }
  })
  field?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-remove-avatar]')) {
      write.removeAvatar().then(shown('Foto removida.')).catch(failed)
    }
  })
}

/** The person changes their photo, name and job title; the e-mail is their Google account's. */
const editProfile = (me: Me) =>
  openFormDialog({
    title: 'Editar perfil',
    submit: 'Salvar',
    done: 'Perfil atualizado.',
    fields: html`<div class="profile-photo-field" data-photo-field>${photoField(me)}</div>
      ${textField({ name: 'name', label: 'Nome', required: true, maxLength: 120, value: me.name })}
      ${textField({ name: 'jobTitle', label: 'Cargo', placeholder: 'Ex.: Engenheira de software', maxLength: 80, value: me.jobTitle ?? '' })}
      <p class="field-hint">O e-mail vem da sua conta Google e não muda aqui.</p>`,
    onSubmit: (data) =>
      write.updateProfile({ name: String(data.get('name')), jobTitle: String(data.get('jobTitle')).trim() || null }),
    onOpen: bindPhoto
  })

/**
 * A person's own page: who they are here, their API tokens (escopo-mvp 4.8) — each acts as them,
 * with exactly their access, on the `/v1` routes — and the applications they connected (ADR-0021).
 */
export const profileView: View = {
  path: '/perfil',
  title: 'Meu perfil',
  render: async () => {
    const [me, tokens, connections] = await Promise.all([read.me(), outwardRead.myTokens(), oauthRead.connections()])
    return html`
      <header class="page-header row">
        <div class="profile-identity">
          ${avatar(me, 'avatar avatar-profile')}
          <div>
            <h1>${me.name}</h1>
            <p class="muted">${me.jobTitle ? html`${me.jobTitle} · ` : ''}${me.email ?? ''}</p>
          </div>
        </div>
        ${me.kind === 'person' ? html`<button type="button" class="button button-secondary" data-edit-profile>${icon('pencil', 16)}Editar perfil</button>` : ''}
      </header>
      <section class="section">
        <div class="section-head">
          <div>
            <h2>Tokens de API</h2>
            <p class="muted">Para scripts e integrações agirem como você na API — com o mesmo acesso que você tem, nada além.</p>
          </div>
          <button type="button" class="button button-primary" data-new-token>${icon('plus', 16)}Novo token</button>
        </div>
        ${tokenTable(tokens.items, 'Você ainda não criou nenhum token.')}
      </section>
      ${connectionsSection(connections.items)}
    `
  },
  bind: (root) => {
    root.querySelector('[data-edit-profile]')?.addEventListener('click', () => void read.me().then(editProfile))
    root
      .querySelector('[data-new-token]')
      ?.addEventListener('click', () => openNewToken('Novo token de API', outwardWrite.createToken))
    bindTokenTable(root)
    bindConnections(root)
  }
}
