import { type Comment, type Member, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { fromTokens, mentionParts, mentionQuery, toTokens } from '@/lib/relations'
import { busy, submitButton } from '@/ui/busy'

import { avatar } from './avatar'
import { icon } from './icons'
import { toast } from './toast'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

/** The reactions offered at a click; any other emoji can still arrive from the API. */
const QUICK_REACTIONS = ['👍', '🎉', '❤️', '👀', '🚀', '✅']

export type CommentsContext = {
  cardId: string
  meId: string
  members: readonly Member[]
  /** Re-renders the card after a change, with the comments the API answered. */
  refresh: (comments?: { items: Comment[] }) => void
  /** A pasted image goes to the card's attachments (escopo-mvp 2.9). */
  attach: (file: File) => void
}

const body = (comment: Comment, names: ReadonlyMap<string, string>): Html => html`
  <p class="comment-body">${mentionParts(comment.body).map((part) =>
    'text' in part ? part.text : html`<span class="mention">@${names.get(part.memberId) ?? 'alguém'}</span>`
  )}</p>
`

const reactions = (comment: Comment, meId: string): Html => html`
  <div class="reactions">
    ${comment.reactions.map(
      (
        reaction
      ) => html`<button type="button" class="reaction" data-react="${comment.id}" data-emoji="${reaction.emoji}"
        aria-pressed="${reaction.memberIds.includes(meId)}" aria-label="${reaction.emoji} ${reaction.memberIds.length}">
        ${reaction.emoji} <span>${reaction.memberIds.length}</span></button>`
    )}
    <details class="reaction-picker">
      <summary class="button button-ghost button-icon" aria-label="Reagir">${icon('moodSmile', 16)}</summary>
      <div class="select-menu glass reaction-menu">
        ${QUICK_REACTIONS.map((emoji) => html`<button type="button" class="reaction" data-react="${comment.id}" data-emoji="${emoji}" aria-label="${emoji}">${emoji}</button>`)}
      </div>
    </details>
  </div>
`

const item = (comment: Comment, context: CommentsContext, names: ReadonlyMap<string, string>): Html => html`
  <li data-comment-id="${comment.id}">
    ${avatar(comment.author)}
    <div class="comment-content">
      <p><strong>${comment.author.name}</strong> <span class="muted">· ${WHEN.format(new Date(comment.createdAt))}${comment.editedAt ? ' · editado' : ''}</span>
        ${comment.author.id === context.meId ? html`<button type="button" class="button button-ghost button-small" data-edit-comment="${comment.id}">Editar</button>` : ''}</p>
      ${body(comment, names)}
      ${reactions(comment, context.meId)}
    </div>
  </li>
`

/**
 * Comments with mentions, edits and reactions (escopo-mvp 2.8): the composer on top, the newest
 * comment right under it.
 */
export const commentsSection = (comments: readonly Comment[], context: CommentsContext): Html => {
  const names = new Map(context.members.map((member) => [member.id, member.name]))
  const newestFirst = [...comments].reverse()
  return html`
    <section class="comments-block" data-comments>
      <form class="composer" data-comment>
        ${avatar({ id: context.meId, name: context.members.find((member) => member.id === context.meId)?.name ?? '' })}
        <div class="composer-box">
          <label class="sr-only" for="card-comment">Novo comentário</label>
          <textarea id="card-comment" class="input textarea" name="body" rows="2" required
            placeholder="Adicionar comentário… @ menciona alguém; cole uma imagem para anexar"></textarea>
          <ul class="select-menu glass mention-menu" role="listbox" hidden></ul>
          <button type="submit" class="button button-primary button-small align-start">Comentar</button>
        </div>
      </form>
      ${newestFirst.length ? html`<ul class="comments">${newestFirst.map((comment) => item(comment, context, names))}</ul>` : ''}
    </section>
  `
}

const run = (change: Promise<{ items: Comment[] }>, context: CommentsContext) =>
  change
    .then((comments) => context.refresh(comments))
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))

export const bindComments = (root: HTMLElement, comments: readonly Comment[], context: CommentsContext): void => {
  const section = root.querySelector<HTMLElement>('[data-comments]')
  if (!section) {
    return
  }
  const form = section.querySelector<HTMLFormElement>('[data-comment]') as HTMLFormElement
  const textarea = form.querySelector('textarea') as HTMLTextAreaElement
  bindMentionMenu(form, textarea, context.members)
  bindPaste(textarea, context)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void busy(submitButton(form), () =>
      run(write.comment(context.cardId, toTokens(textarea.value.trim(), context.members)), context)
    )
  })
  section.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-react], [data-edit-comment]')
    if (target?.dataset.react) {
      const pressed = target.getAttribute('aria-pressed') === 'true'
      void run(write.react(context.cardId, target.dataset.react, target.dataset.emoji ?? '', !pressed), context)
    } else if (target?.dataset.editComment) {
      startEdit(section, comments, target.dataset.editComment, context)
    }
  })
}

/** The comment's text becomes an editor in place: Salvar sends it, Cancelar draws the card again. */
const startEdit = (section: HTMLElement, comments: readonly Comment[], commentId: string, context: CommentsContext) => {
  const comment = comments.find((each) => each.id === commentId)
  const holder = section.querySelector(`[data-comment-id="${commentId}"] .comment-body`)
  if (!comment || !holder) {
    return
  }
  const names = new Map(context.members.map((member) => [member.id, member.name]))
  const editor = document.createElement('form')
  editor.className = 'stack-tight'
  editor.innerHTML = html`
    <label class="sr-only" for="edit-${commentId}">Editar comentário</label>
    <textarea id="edit-${commentId}" class="input textarea" rows="3" required>${fromTokens(comment.body, names)}</textarea>
    <div class="row"><button type="submit" class="button button-primary">Salvar</button>
    <button type="button" class="button button-ghost" data-cancel>Cancelar</button></div>
  `.value
  holder.replaceWith(editor)
  const textarea = editor.querySelector('textarea') as HTMLTextAreaElement
  textarea.focus()
  editor.querySelector('[data-cancel]')?.addEventListener('click', () => context.refresh())
  editor.addEventListener('submit', (event) => {
    event.preventDefault()
    void busy(submitButton(editor), () =>
      run(write.editComment(context.cardId, commentId, toTokens(textarea.value.trim(), context.members)), context)
    )
  })
}

/** Typing `@` and some letters offers the members whose name matches; choosing one writes `@Name `. */
const bindMentionMenu = (form: HTMLFormElement, textarea: HTMLTextAreaElement, members: readonly Member[]) => {
  const menu = form.querySelector('.mention-menu') as HTMLElement
  const active = members.filter((member) => member.status === 'active' && member.kind === 'person')
  const choose = (name: string) => {
    const found = mentionQuery(textarea.value, textarea.selectionStart)
    if (found) {
      const after = textarea.value.slice(textarea.selectionStart)
      textarea.value = `${textarea.value.slice(0, found.start)}@${name} ${after}`
      textarea.focus()
    }
    menu.hidden = true
  }
  textarea.addEventListener('input', () => {
    const found = mentionQuery(textarea.value, textarea.selectionStart)
    const query = found?.query.toLowerCase() ?? ''
    const matches = found ? active.filter((member) => member.name.toLowerCase().includes(query)).slice(0, 6) : []
    menu.innerHTML =
      html`${matches.map((member) => html`<li role="option" tabindex="-1" data-name="${member.name}"><span>${member.name}</span>${member.kind === 'agent' ? html`<small>Agente</small>` : ''}</li>`)}`.value
    menu.hidden = matches.length === 0
  })
  menu.addEventListener('mousedown', (event) => {
    event.preventDefault()
    const option = (event.target as HTMLElement).closest<HTMLElement>('[data-name]')
    if (option) {
      choose(option.dataset.name ?? '')
    }
  })
}

const bindPaste = (textarea: HTMLTextAreaElement, context: CommentsContext) => {
  textarea.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'))
    if (files.length) {
      event.preventDefault()
      files.forEach(context.attach)
    }
  })
}
