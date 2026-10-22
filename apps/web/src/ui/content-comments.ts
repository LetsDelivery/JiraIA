import type { Editor } from '@tiptap/core'

import { type ContentComment, drawWrite } from '@/api/draw'
import type { Member } from '@/api/requests'
import { markSelection, revealComment, unmarkComment } from '@/editor/marks'
import { initials } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { mentionParts, toTokens } from '@/lib/relations'
import { busy, submitButton } from '@/ui/busy'
import { toast } from './toast'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

export type CommentsContext = {
  contentId: string
  members: readonly Member[]
  editor: Editor | undefined
}

/** A thread being started on selected text, until its first comment is sent or it is cancelled. */
let pending: { contentId: string; anchorId: string; quote: string } | undefined

/** Starts a thread on the selection: marks it in the page and opens the composer (escopo-mvp 5.7). */
export const startInlineComment = (contentId: string, editor: Editor, redraw: () => void): void => {
  const anchorId = crypto.randomUUID()
  pending = { contentId, anchorId, quote: markSelection(editor, anchorId) }
  redraw()
}

const body = (comment: ContentComment, names: ReadonlyMap<string, string>): Html => html`
  <p class="comment-body">${mentionParts(comment.body).map((part) =>
    'text' in part ? part.text : html`<span class="mention">@${names.get(part.memberId) ?? 'alguém'}</span>`
  )}</p>
`

const line = (comment: ContentComment, names: ReadonlyMap<string, string>): Html => html`
  <li>
    <span class="avatar">${initials(comment.author.name)}</span>
    <div class="comment-content">
      <p><strong>${comment.author.name}</strong> <span class="muted">· ${WHEN.format(new Date(comment.createdAt))}${comment.editedAt ? ' · editado' : ''}</span></p>
      ${body(comment, names)}
    </div>
  </li>
`

let composers = 0

const composer = (label: string, attributes: Html, placeholder: string): Html => {
  composers += 1
  const id = `page-comment-${composers}`
  return html`
    <form class="stack-tight composer" ${attributes}>
      <label class="sr-only" for="${id}">${label}</label>
      <textarea id="${id}" class="input textarea" name="body" rows="2" required placeholder="${placeholder}"></textarea>
      <button type="submit" class="button button-primary button-small align-start">Comentar</button>
    </form>
  `
}

const thread = (
  root: ContentComment,
  replies: readonly ContentComment[],
  names: ReadonlyMap<string, string>
): Html => html`
  <article class="page-thread ${root.resolvedAt ? 'is-resolved' : ''}" data-thread="${root.id}">
    ${root.quote ? html`<button type="button" class="page-thread-quote" data-reveal="${root.anchorId ?? ''}">“${root.quote}”</button>` : ''}
    <ul class="comments">${[root, ...replies].map((each) => line(each, names))}</ul>
    <div class="row">
      <button type="button" class="button button-ghost button-small" data-resolve="${root.id}" data-anchor="${root.anchorId ?? ''}" data-resolved="${root.resolvedAt !== null}">
        ${root.resolvedAt ? 'Reabrir' : 'Resolver'}</button>
    </div>
    ${root.resolvedAt ? '' : composer('Responder', html`data-reply="${root.id}"`, 'Responder…')}
  </article>
`

/** Comments on the page and on stretches of it, open threads first, resolved ones folded. */
export const commentsPanel = (comments: readonly ContentComment[], context: CommentsContext): Html => {
  const names = new Map(context.members.map((member) => [member.id, member.name]))
  const roots = comments.filter((comment) => !comment.parentId)
  const replies = (id: string) => comments.filter((comment) => comment.parentId === id)
  const open = roots.filter((root) => !root.resolvedAt)
  const resolved = roots.filter((root) => root.resolvedAt)
  const starting = pending?.contentId === context.contentId ? pending : undefined
  return html`
    <section class="stack-tight" data-page-comments>
      ${
        starting
          ? html`<div class="page-thread is-new"><p class="page-thread-quote">“${starting.quote}”</p>
              ${composer('Comentário no trecho', html`data-inline`, 'Comente o trecho selecionado…')}
              <button type="button" class="button button-ghost button-small" data-cancel-inline>Cancelar</button></div>`
          : composer('Comentar', html`data-page-comment`, 'Comente… @ menciona alguém')
      }
      ${open.length ? open.map((root) => thread(root, replies(root.id), names)) : html`<p class="muted">Nenhum comentário aberto.</p>`}
      ${resolved.length ? html`<details><summary class="muted">Resolvidos (${resolved.length})</summary>${resolved.map((root) => thread(root, replies(root.id), names))}</details>` : ''}
    </section>
  `
}

const send = (
  context: CommentsContext,
  input: { body: string; parentId?: string; anchorId?: string; quote?: string }
) =>
  drawWrite
    .comment(context.contentId, { ...input, body: toTokens(input.body, context.members) })
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))

const onSubmit = async (context: CommentsContext, form: HTMLFormElement): Promise<void> => {
  const text = String(new FormData(form).get('body')).trim()
  if (!text) {
    return
  }
  if (form.hasAttribute('data-inline') && pending) {
    const { anchorId, quote } = pending
    pending = undefined
    await send(context, { body: text, anchorId, quote })
  } else if (form.dataset.reply) {
    await send(context, { body: text, parentId: form.dataset.reply })
  } else {
    await send(context, { body: text })
  }
}

/** Resolving takes the thread's mark off the text; the thread stays, folded with the resolved. */
const resolve = (context: CommentsContext, target: HTMLElement): void => {
  const resolved = target.dataset.resolved !== 'true'
  if (resolved && target.dataset.anchor && context.editor?.isEditable) {
    unmarkComment(context.editor, target.dataset.anchor)
  }
  drawWrite
    .resolveComment(context.contentId, target.dataset.resolve ?? '', resolved)
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
}

const reveal = (context: CommentsContext, target: HTMLElement): void => {
  if (context.editor && !revealComment(context.editor, target.dataset.reveal ?? '')) {
    toast('O trecho comentado não está mais no conteúdo.')
  }
}

const cancelInline = (context: CommentsContext, redraw: () => void): void => {
  if (pending && context.editor) {
    unmarkComment(context.editor, pending.anchorId)
  }
  pending = undefined
  redraw()
}

export const bindCommentsPanel = (root: HTMLElement, context: CommentsContext, redraw: () => void): void => {
  const panel = root.querySelector<HTMLElement>('[data-page-comments]')
  const actions: Record<string, (target: HTMLElement) => void> = {
    'data-resolve': (target) => resolve(context, target),
    'data-reveal': (target) => reveal(context, target),
    'data-cancel-inline': () => cancelInline(context, redraw)
  }
  panel?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    void busy(submitButton(form), () => onSubmit(context, form))
  })
  panel?.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-resolve], [data-reveal], [data-cancel-inline]'
    )
    const action = Object.entries(actions).find(([attribute]) => target?.hasAttribute(attribute))
    if (target && action) {
      action[1](target)
    }
  })
}

/** Opens the thread whose text was clicked in the page. */
export const focusThread = (root: HTMLElement, anchorId: string): void => {
  const quote = root.querySelector<HTMLElement>(`[data-reveal="${CSS.escape(anchorId)}"]`)
  const thread = quote?.closest<HTMLElement>('[data-thread]')
  thread?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  thread?.classList.add('is-focused')
  window.setTimeout(() => thread?.classList.remove('is-focused'), 1200)
}
