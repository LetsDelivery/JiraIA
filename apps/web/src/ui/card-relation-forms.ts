import { type Relations, write } from '@/api/requests'
import { refusalSentence } from '@/lib/refusal'
import { parseLinkChoice } from '@/lib/relations'
import { cardKeyIn } from '@/lib/search'
import { busy, submitButton } from '@/ui/busy'
import { bindCardPicker } from './card-picker'
import type { ComposeForm, RelationsContext } from './card-relations'
import { toast } from './toast'

type Run = (change: Promise<unknown>) => Promise<void>

/** Wires the relations panels: opening a ref, removing one, and the two composers. */
export const bindRelations = (root: HTMLElement, relations: Relations, context: RelationsContext): void => {
  const section = root.querySelector<HTMLElement>('[data-relations]')
  if (!section) {
    return
  }
  const run: Run = (change) =>
    change.then(context.refresh).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  _bindRefs(section, relations, context, run)
  for (const panel of section.querySelectorAll<HTMLElement>('[data-compose-name]')) {
    _bindComposer(panel, context)
  }
  for (const button of root.querySelectorAll<HTMLElement>('[data-compose-start]')) {
    button.addEventListener('click', () => startComposing(section, button.dataset.composeStart as ComposeForm, context))
  }
  _bindSubtask(section, relations, context, run)
  _bindLink(section, context, run)
}

const _bindRefs = (section: HTMLElement, relations: Relations, context: RelationsContext, run: Run): void => {
  const refs = [relations.parent, ...relations.children, ...relations.links.map((link) => link.card)]
  section.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-open-ref], [data-unlink], [data-clear-parent]'
    )
    const opened = refs.find((each) => each?.id === target?.dataset.openRef)
    if (opened) {
      context.open(opened)
    } else if (target?.dataset.unlink) {
      void run(write.unlink(context.card.id, target.dataset.unlink))
    } else if (target?.hasAttribute('data-clear-parent')) {
      void run(write.updateCard(context.card, { parentId: null }))
    }
  })
}

/** The action bar opens a composer in its panel, which shows even while it has nothing yet. */
const startComposing = (section: HTMLElement, form: ComposeForm, context: RelationsContext): void => {
  const panel = section.querySelector<HTMLElement>(`[data-compose-name="${form}"]`)
  if (!panel) {
    return
  }
  panel.dataset.compose = 'open'
  context.remember(form, true)
  panel.scrollIntoView({ block: 'nearest' })
  panel.querySelector<HTMLInputElement>('.compose input:not([type="hidden"])')?.focus()
}

/** Cancelar closes and empties the composer; an empty panel goes out of sight with it. */
const _bindComposer = (panel: HTMLElement, context: RelationsContext): void => {
  panel.querySelector('[data-compose-cancel]')?.addEventListener('click', () => {
    panel.querySelector<HTMLFormElement>('form')?.reset()
    panel.dataset.compose = 'closed'
    context.remember(panel.dataset.composeName as ComposeForm, false)
  })
}

const _bindSubtask = (section: HTMLElement, relations: Relations, context: RelationsContext, run: Run): void => {
  const form = section.querySelector<HTMLFormElement>('[data-add-subtask]')
  if (!form) {
    return
  }
  form.addEventListener('click', (event) => {
    const mode = (event.target as HTMLElement).closest<HTMLElement>('[data-mode-switch]')?.dataset.modeSwitch
    if (mode) {
      form.dataset.mode = mode
      form.querySelector<HTMLInputElement>(mode === 'pick' ? '#subtask-pick' : '#new-subtask')?.focus()
    }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const data = new FormData(form)
    const title = String(data.get('title') ?? '').trim()
    if (form.dataset.mode === 'new' && title) {
      void busy(submitButton(form), () =>
        run(
          write.createCard(context.card.spaceId, {
            title,
            parentId: context.card.id,
            typeId: String(data.get('typeId'))
          })
        )
      )
    }
  })
  _bindExisting(form, relations, context, run)
}

/** "Escolher um card já criado": a card of this space, not yet under this one, becomes its subtask. */
const _bindExisting = (form: HTMLFormElement, relations: Relations, context: RelationsContext, run: Run): void => {
  const children = new Set(relations.children.map((child) => child.id))
  bindCardPicker(form.querySelector('[data-subtask-picker]') as HTMLElement, {
    accept: (card) => card.spaceId === context.card.spaceId && card.id !== context.card.id && !children.has(card.id),
    onPick: (card) => void run(write.updateCard(card, { parentId: context.card.id }))
  })
}

const _bindLink = (section: HTMLElement, context: RelationsContext, run: Run): void => {
  const form = section.querySelector<HTMLFormElement>('[data-add-link]')
  if (!form) {
    return
  }
  const input = form.querySelector('#link-key') as HTMLInputElement
  const submit = form.querySelector('[data-link-submit]') as HTMLButtonElement
  const choice = () => parseLinkChoice(String(new FormData(form).get('choice')))
  input.addEventListener('input', () => {
    submit.disabled = !cardKeyIn(input.value)
  })
  bindCardPicker(form.querySelector('[data-link-picker]') as HTMLElement, {
    accept: (card) => card.id !== context.card.id,
    onPick: () => {
      submit.disabled = false
    }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const key = cardKeyIn(input.value)
    if (key) {
      void busy(submitButton(form), () => run(write.link(context.card.id, { ...choice(), key })))
    }
  })
  form.querySelector('[data-create-linked]')?.addEventListener('click', () => {
    void _createLinked(input, context, choice(), run)
  })
}

/** "Criar card vinculado": what is typed becomes a new card of this space, linked at once. */
const _createLinked = async (
  input: HTMLInputElement,
  context: RelationsContext,
  choice: ReturnType<typeof parseLinkChoice>,
  run: Run
): Promise<void> => {
  const title = input.value.trim()
  if (!title || cardKeyIn(title)) {
    toast('Escreva no campo o título do card novo.', 'error')
    input.focus()
    return
  }
  await run(
    write
      .createCard(context.card.spaceId, { title })
      .then((created) => write.link(context.card.id, { ...choice, key: created.key }))
  )
}
