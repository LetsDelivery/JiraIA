import { type Draft, drawWrite } from '@/api/draw'
import laisLogo from '@/assets/lais.png'
import { contentPath } from '@/lib/draw'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'

import type { CreateTarget } from './create-menu'
import { icon } from './icons'

type Kind = 'auto' | 'page' | 'whiteboard'
type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; draft?: Draft }
  | { role: 'error'; text: string }

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'auto', label: 'Automático' },
  { kind: 'page', label: 'Página' },
  { kind: 'whiteboard', label: 'Quadro branco' }
]

const SUGGESTIONS: { kind: Kind; label: string; prompt: string }[] = [
  {
    kind: 'page',
    label: 'Documente o processo de devolução de pedidos',
    prompt: 'Documente o processo de devolução de pedidos: quem pede, quem aprova, prazos e o que o lojista vê.'
  },
  {
    kind: 'whiteboard',
    label: 'Mapeie a jornada do lojista no app',
    prompt: 'Mapeie a jornada do lojista no app, da criação do pedido à entrega, com as dores de cada etapa.'
  },
  {
    kind: 'page',
    label: 'Escreva a ata da review de produto',
    prompt: 'Escreva a ata da review quinzenal de produto: presentes, o que foi lançado, decisões e próximos passos.'
  }
]

/** A draft in the chat: the page's first lines, or the board's sections, and the button that makes it. */
const preview = (draft: Draft): Html => html`
  <div class="ai-draft">
    <p class="ai-draft-head">${icon(draft.kind === 'page' ? 'fileText' : 'chalkboard', 16)}<strong>${draft.title}</strong>
      ${draft.byModel ? '' : html`<span class="badge">Sem IA neste ambiente</span>`}</p>
    ${
      draft.kind === 'page'
        ? html`<pre class="ai-draft-text">${draft.markdown.split('\n').slice(0, 14).join('\n')}${draft.markdown.split('\n').length > 14 ? '\n…' : ''}</pre>`
        : html`<div class="ai-draft-board">${draft.sections.map(
            (section) => html`<div class="ai-draft-section"><p class="label">${section.title}</p>
              <div class="chips">${section.notes.map((note) => html`<span class="chip">${note}</span>`)}</div></div>`
          )}</div>`
    }
    <button type="button" class="button button-primary align-start" data-create-draft>${draft.kind === 'page' ? 'Criar página' : 'Criar quadro'}</button>
  </div>
`

const turn = (each: Turn): Html => {
  if (each.role === 'user') {
    return html`<li class="ai-turn ai-turn-user"><p>${each.text}</p></li>`
  }
  if (each.role === 'error') {
    return html`<li class="ai-turn ai-turn-error" role="alert"><p>${each.text}</p></li>`
  }
  return html`<li class="ai-turn ai-turn-assistant"><p>${each.text}</p>${each.draft ? preview(each.draft) : ''}</li>`
}

const composer = (kind: Kind, busy: boolean): Html => html`
  <form class="ai-composer" data-ai-form>
    <label class="sr-only" for="ai-prompt">Descreva o que você quer criar</label>
    <textarea id="ai-prompt" name="prompt" rows="3" placeholder="Descreva o que você quer criar, ou peça um ajuste no rascunho" ${busy ? html`disabled` : ''}></textarea>
    <div class="ai-composer-row">
      <div class="chips" role="group" aria-label="O que criar">${KINDS.map(
        (each) =>
          html`<button type="button" class="chip chip-toggle" data-ai-kind="${each.kind}" aria-pressed="${each.kind === kind}">${each.label}</button>`
      )}</div>
      <button type="submit" class="button button-primary button-icon ai-send" aria-label="Enviar" ${busy ? html`disabled` : ''}>${icon('arrowUp', 18)}</button>
    </div>
  </form>
`

const body = (turns: readonly Turn[], kind: Kind, busy: boolean): Html => html`
  <button type="button" class="button button-ghost button-icon ai-close" data-close aria-label="Fechar">${icon('x')}</button>
  <div class="ai-head">
    <img class="ai-logo" src="${laisLogo}" alt="" width="52" height="52" />
    <h2>O que você vai criar hoje?</h2>
  </div>
  ${turns.length ? html`<ol class="ai-chat" aria-live="polite">${turns.map(turn)}${busy ? html`<li class="ai-turn ai-turn-assistant muted" aria-busy="true"><p>Escrevendo o rascunho…</p></li>` : ''}</ol>` : ''}
  ${composer(kind, busy)}
  ${
    turns.length
      ? ''
      : html`<div class="ai-suggestions">${SUGGESTIONS.map(
          (each, index) => html`<button type="button" class="ai-suggestion" data-suggestion="${index}">
            ${icon(each.kind === 'page' ? 'fileText' : 'chalkboard', 18)}<span>${each.label}</span>
            <small class="muted">${each.kind === 'page' ? 'Página' : 'Quadro branco'}</small></button>`
        )}</div>`
  }
  <p class="ai-note muted">${icon('sparkles', 14)} Utiliza inteligência artificial. Verifique os resultados.</p>
`

/**
 * "Criar com Laís" (ADR-0011): the person describes what they want; the model answers with a draft —
 * a page or a whiteboard — they can refine in the same chat and then create where they were.
 */
export const openDrawAi = (target: CreateTarget): void => {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog draw-ai'
  dialog.setAttribute('aria-label', 'Criar com Laís')
  document.body.append(dialog)
  const state = { turns: [] as Turn[], kind: 'auto' as Kind, busy: false }
  const draw = () => {
    dialog.innerHTML = body(state.turns, state.kind, state.busy).value
    dialog.querySelector<HTMLTextAreaElement>('#ai-prompt')?.focus()
    dialog.querySelector('.ai-chat')?.lastElementChild?.scrollIntoView({ block: 'end' })
  }
  const close = () => {
    dialog.close()
    dialog.remove()
  }
  const send = (text: string) => void ask(target, state, text, draw)
  dialog.addEventListener('cancel', close)
  dialog.addEventListener('click', (event) => onClick(event, { target, state, draw, close, send }))
  dialog.addEventListener('submit', (event) => {
    event.preventDefault()
    send(String(new FormData(event.target as HTMLFormElement).get('prompt') ?? '').trim())
  })
  dialog.addEventListener('keydown', (event) => {
    const field = event.target as HTMLElement
    if (event.key === 'Enter' && !event.shiftKey && field.id === 'ai-prompt') {
      event.preventDefault()
      send((field as HTMLTextAreaElement).value.trim())
    }
  })
  dialog.showModal()
  draw()
}

type Context = {
  target: CreateTarget
  state: { turns: Turn[]; kind: Kind; busy: boolean }
  draw: () => void
  close: () => void
  send: (text: string) => void
}

const onClick = (event: MouseEvent, context: Context) => {
  const element = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-close], [data-ai-kind], [data-suggestion], [data-create-draft]'
  )
  if (element?.hasAttribute('data-close')) {
    context.close()
  } else if (element?.dataset.aiKind) {
    context.state.kind = element.dataset.aiKind as Kind
    context.draw()
  } else if (element?.dataset.suggestion) {
    const suggestion = SUGGESTIONS[Number(element.dataset.suggestion)]
    if (suggestion) {
      context.state.kind = suggestion.kind
      context.send(suggestion.prompt)
    }
  } else if (element?.hasAttribute('data-create-draft')) {
    void createFrom(context)
  }
}

/** The whole conversation goes each time, so a refinement is read against what came before. */
const ask = async (target: CreateTarget, state: Context['state'], text: string, draw: () => void) => {
  if (!text || state.busy) {
    return
  }
  state.turns.push({ role: 'user', text })
  state.busy = true
  draw()
  const messages = state.turns
    .filter((each): each is Exclude<Turn, { role: 'error' }> => each.role !== 'error')
    .map((each) => ({ role: each.role, text: each.text }))
  try {
    const draft = await drawWrite.draft(target.spaceId, { kind: state.kind, messages })
    state.turns.push({ role: 'assistant', text: draft.reply, draft })
  } catch (refusal) {
    state.turns.push({ role: 'error', text: refusalSentence(refusal) })
  }
  state.busy = false
  draw()
}

/** The latest draft becomes content where the menu was opened — and opens, ready to edit. */
const createFrom = async ({ target, state, close }: Context) => {
  const latest = [...state.turns]
    .reverse()
    .find((each): each is Extract<Turn, { role: 'assistant' }> => each.role === 'assistant' && Boolean(each.draft))
  const draft = latest?.draft
  if (!draft) {
    return
  }
  const created = await drawWrite.create(target.spaceId, {
    kind: draft.kind,
    title: draft.title.slice(0, 255) || 'Sem título',
    ...(target.parentId ? { parentId: target.parentId } : {}),
    draft: { json: draft.json, text: draft.text }
  })
  close()
  navigate(contentPath(target.spaceId, created.id))
}
