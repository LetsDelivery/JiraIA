import { type Attachment, type Comment, type Member, write } from '@/api/requests'
import { pastedName } from '@/lib/comment-files'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { mentionParts } from '@/lib/relations'

import { fillThumbs } from './attachment-thumbs'
import { openAttachmentViewer } from './attachment-viewer'
import { avatar } from './avatar'
import { type ComposerHandle, mountComposer } from './comment-composer'
import { fileLook, linkFiles } from './comment-files'
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
  /** A pasted file goes to the card's attachments (escopo-mvp 2.9) and is cited in the comment. */
  attach: (file: File) => void
  /** The card's attachments, as the Anexos panel lists them: what a comment's `📎 name` points at. */
  attachments: readonly Attachment[]
  /** The comment being written when the card was last drawn; nothing when none was. */
  draft?: { markdown: string; focused: boolean } | undefined
}

/** The composer of a new comment, as the card keeps it across a redraw. */
export type CommentsHandle = {
  draft: () => { markdown: string; focused: boolean } | undefined
  destroy: () => void
}

const PLACEHOLDER = 'Adicionar comentário… @ menciona alguém; cole uma imagem para anexar'

/** The comment as plain text until the editor has drawn its Markdown (`bindComments`). */
const body = (comment: Comment, names: ReadonlyMap<string, string>): Html => html`
  <p class="comment-body" data-comment-body="${comment.id}">${mentionParts(comment.body).map((part) =>
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

const closedComposer = (): Html =>
  html`<button type="button" class="input composer-closed" data-open-composer>${PLACEHOLDER}</button>`

/**
 * Comments with mentions, edits and reactions (escopo-mvp 2.8): the composer on top, the newest
 * comment right under it.
 */
export const commentsSection = (comments: readonly Comment[], context: CommentsContext): Html => {
  const names = new Map(context.members.map((member) => [member.id, member.name]))
  const newestFirst = [...comments].reverse()
  return html`
    <section class="comments-block" data-comments>
      <div class="composer" data-comment>
        ${avatar({ id: context.meId, name: context.members.find((member) => member.id === context.meId)?.name ?? '' })}
        <div class="composer-box" data-composer-host>${closedComposer()}</div>
      </div>
      ${newestFirst.length ? html`<ul class="comments">${newestFirst.map((comment) => item(comment, context, names))}</ul>` : ''}
    </section>
  `
}

const run = (change: Promise<{ items: Comment[] }>, context: CommentsContext) =>
  change
    .then((comments) => context.refresh(comments))
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))

export const bindComments = (
  root: HTMLElement,
  comments: readonly Comment[],
  context: CommentsContext
): CommentsHandle | undefined => {
  const section = root.querySelector<HTMLElement>('[data-comments]')
  if (!section) {
    return undefined
  }
  void drawBodies(section, comments, context)
  const composer = composerOf(section, context)
  section.addEventListener('click', (event) => _onClick(event, section, comments, context, composer.open))
  return composer.handle
}

const _onClick = (
  event: MouseEvent,
  section: HTMLElement,
  comments: readonly Comment[],
  context: CommentsContext,
  open: () => void
): void => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-react], [data-edit-comment], [data-open-file], [data-open-composer]'
  )
  if (target?.dataset.react) {
    react(target, target.dataset.react, context)
  } else if (target?.dataset.editComment) {
    startEdit(section, comments, target.dataset.editComment, context)
  } else if (target?.dataset.openFile) {
    openAttachmentViewer(context.attachments, Number(target.dataset.openFile))
  } else if (target?.hasAttribute('data-open-composer')) {
    open()
  }
}

const react = (button: HTMLElement, commentId: string, context: CommentsContext): void => {
  const on = button.getAttribute('aria-pressed') !== 'true'
  guessReaction(button, on)
  write
    .react(context.cardId, commentId, button.dataset.emoji ?? '', on)
    .then((answered) => context.refresh(answered))
    .catch((refusal: unknown) => {
      toast(refusalSentence(refusal), 'error')
      context.refresh()
    })
}

/**
 * Each comment's Markdown drawn through the editor's schema, and each `📎 name` it cites turned into
 * the card's attachment of that name. The editor's code is already loaded when a card is open.
 */
const drawBodies = async (section: HTMLElement, comments: readonly Comment[], context: CommentsContext) => {
  const { commentHtml } = await import('@/editor/comment')
  for (const comment of comments) {
    const holder = section.querySelector<HTMLElement>(`[data-comment-body="${comment.id}"]`)
    if (holder) {
      holder.outerHTML = `<div class="comment-body comment-rich" data-comment-body="${comment.id}">${commentHtml(comment.body, context.members)}</div>`
      const drawn = section.querySelector<HTMLElement>(`[data-comment-body="${comment.id}"]`)
      drawn && linkFiles(drawn, context.attachments, comment.createdAt)
    }
  }
  await fillThumbs(section, context.attachments)
}

/** The names already on the card or given to a file pasted since it was drawn. */
const citeFiles = (context: CommentsContext) => {
  const taken = new Set(context.attachments.map((attachment) => attachment.name))
  return (files: File[]): string[] =>
    files.map((file) => {
      const name = pastedName(file, new Date(), taken)
      taken.add(name)
      context.attach(new File([file], name, { type: file.type }))
      return name
    })
}

/** The new comment's composer: a line to click until a person starts one, then the editor and its bar. */
const composerOf = (section: HTMLElement, context: CommentsContext) => {
  const host = section.querySelector('[data-composer-host]') as HTMLElement
  const attach = citeFiles(context)
  let composer: ComposerHandle | undefined
  const close = () => {
    composer?.destroy()
    composer = undefined
    host.innerHTML = closedComposer().value
  }
  const open = (markdown = '', focus = true) => {
    composer?.destroy()
    composer = mountComposer(host, {
      members: context.members,
      markdown,
      placeholder: PLACEHOLDER,
      submit: 'Comentar',
      focus,
      attach,
      look: fileLook(context.attachments),
      save: (written, text) => {
        close()
        void send(section, written, text, context, open)
      },
      cancel: close
    })
  }
  if (context.draft) {
    open(context.draft.markdown, context.draft.focused)
  }
  const handle: CommentsHandle = {
    draft: () => (composer ? { markdown: composer.draft(), focused: composer.focused() } : undefined),
    destroy: () => composer?.destroy()
  }
  return { open: () => open(), handle }
}

/**
 * The comment shows under the composer at once, faint, and the composer closes; the API's answer
 * then draws it for real. A refusal takes it back out and opens the composer with the text again.
 */
const send = async (
  section: HTMLElement,
  markdown: string,
  text: string,
  context: CommentsContext,
  reopen: (markdown: string) => void
) => {
  const pending = showPending(section, text, context)
  try {
    context.refresh(await write.comment(context.cardId, markdown))
  } catch (refusal: unknown) {
    pending.remove()
    reopen(markdown)
    toast(refusalSentence(refusal), 'error')
  }
}

const showPending = (section: HTMLElement, text: string, context: CommentsContext): HTMLElement => {
  const list = section.querySelector('.comments') ?? section.appendChild(document.createElement('ul'))
  list.classList.add('comments')
  const me = context.members.find((member) => member.id === context.meId)
  const pending = document.createElement('li')
  pending.className = 'comment-pending'
  pending.setAttribute('aria-busy', 'true')
  pending.innerHTML = html`
    ${avatar({ id: context.meId, name: me?.name ?? '' })}
    <div class="comment-content">
      <p><strong>${me?.name ?? ''}</strong> <span class="muted">· enviando…</span></p>
      <p class="comment-body">${text}</p>
    </div>
  `.value
  list.prepend(pending)
  return pending
}

/** A reaction already on the comment turns at the click; one from the picker waits for the API. */
const guessReaction = (button: HTMLElement, on: boolean): void => {
  const count = button.querySelector('span')
  if (!count || button.closest('.reaction-picker')) {
    return
  }
  button.setAttribute('aria-pressed', String(on))
  count.textContent = String(Number(count.textContent) + (on ? 1 : -1))
}

/** The comment becomes the editor in place: Salvar sends it, Cancelar draws the card again. */
const startEdit = (section: HTMLElement, comments: readonly Comment[], commentId: string, context: CommentsContext) => {
  const comment = comments.find((each) => each.id === commentId)
  const holder = section.querySelector(`[data-comment-id="${commentId}"] .comment-body`)
  if (!comment || !holder) {
    return
  }
  const host = document.createElement('div')
  host.className = 'comment-edit'
  holder.replaceWith(host)
  mountComposer(host, {
    members: context.members,
    markdown: comment.body,
    placeholder: '',
    submit: 'Salvar',
    focus: true,
    attach: citeFiles(context),
    look: fileLook(context.attachments),
    save: (markdown) => void run(write.editComment(context.cardId, commentId, markdown), context),
    cancel: () => context.refresh()
  })
}
