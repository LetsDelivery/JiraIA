import type { Card, State } from '@/api/requests'
import { type OpenCardsTo, type Sprint, type SprintInput, sprintsWrite } from '@/api/sprints'
import { html } from '@/lib/html'
import { tally, tallyText } from '@/lib/sprints'

import { bindDatePickers, dateField } from './date-picker'
import { openFormDialog, textField } from './dialog'
import { selectField } from './select'

/** What a sprint dialog sends: only what was filled in. */
const sprintInput = (data: FormData): SprintInput => {
  const text = (name: string) => String(data.get(name) ?? '').trim()
  return {
    ...(text('name') ? { name: text('name') } : {}),
    goal: text('goal'),
    ...(text('startsOn') ? { startsOn: text('startsOn') } : {}),
    ...(text('endsOn') ? { endsOn: text('endsOn') } : {})
  }
}

const sprintFields = (sprint?: Sprint) => html`
  ${textField({
    name: 'name',
    label: 'Nome',
    required: sprint !== undefined,
    value: sprint?.name ?? '',
    maxLength: 80,
    ...(sprint ? {} : { hint: 'Em branco: o próximo número, como “Sprint 18”.' })
  })}
  ${textField({ name: 'goal', label: 'Objetivo', value: sprint?.goal ?? '', hint: 'O que o time quer entregar nesta sprint.' })}
  <div class="sprint-dates">
    ${dateField({ name: 'startsOn', label: 'Início', value: sprint?.startsOn ?? null })}
    ${dateField({ name: 'endsOn', label: 'Fim', value: sprint?.endsOn ?? null })}
  </div>
  ${sprint ? '' : html`<p class="field-hint">Datas em branco: logo depois da última sprint, com a mesma duração.</p>`}
`

/** A new sprint: what is left blank follows the space's last sprint. */
export const openCreateSprint = (spaceId: string): void =>
  openFormDialog({
    title: 'Criar sprint',
    submit: 'Criar sprint',
    done: 'Sprint criada.',
    fields: sprintFields(),
    onOpen: bindDatePickers,
    onSubmit: (data) => sprintsWrite.create(spaceId, sprintInput(data))
  })

/** Name, goal and dates of a sprint that has not closed. */
export const openEditSprint = (sprint: Sprint): void =>
  openFormDialog({
    title: `Editar ${sprint.name}`,
    submit: 'Salvar',
    done: 'Sprint atualizada.',
    fields: sprintFields(sprint),
    onOpen: bindDatePickers,
    onSubmit: (data) => sprintsWrite.update(sprint, sprintInput(data))
  })

/** Starting confirms the name, goal and dates; what the sprint holds now is what the team commits to. */
export const openStartSprint = (
  sprint: Sprint,
  cards: readonly Card[],
  states: readonly State[],
  points: boolean
): void =>
  openFormDialog({
    title: `Iniciar ${sprint.name}`,
    submit: 'Iniciar sprint',
    done: 'Sprint iniciada.',
    fields: html`
      <p class="muted">${tallyText(tally(cards, states), points)} entram como compromisso da sprint.</p>
      ${sprintFields(sprint)}
    `,
    onOpen: bindDatePickers,
    onSubmit: (data) => sprintsWrite.start(sprint, sprintInput(data))
  })

const DESTINATIONS: Record<OpenCardsTo, string> = {
  next: 'Próxima sprint planejada',
  new: 'Uma sprint nova',
  backlog: 'Backlog'
}

/** Closing says what was done and asks where the open cards go: the next sprint, a new one, or the backlog. */
export const openCloseSprint = (
  sprint: Sprint,
  context: { cards: readonly Card[]; states: readonly State[]; points: boolean; nextPlanned?: Sprint | undefined }
): void => {
  const counted = tally(context.cards, context.states)
  const open = { cards: counted.cards - counted.done, points: 0 }
  const options = (Object.keys(DESTINATIONS) as OpenCardsTo[])
    .filter((value) => value !== 'next' || context.nextPlanned)
    .map((value) => ({
      value,
      label: value === 'next' ? `${DESTINATIONS.next}: ${context.nextPlanned?.name}` : DESTINATIONS[value]
    }))
  openFormDialog({
    title: `Encerrar ${sprint.name}`,
    submit: 'Encerrar sprint',
    done: 'Sprint encerrada.',
    fields: html`
      <p><strong>${counted.done}</strong> ${counted.done === 1 ? 'card concluído' : 'cards concluídos'} e <strong>${open.cards}</strong> ${open.cards === 1 ? 'aberto' : 'abertos'}.</p>
      ${open.cards > 0 ? selectField({ name: 'openCardsTo', label: 'Levar os abertos para', options, value: context.nextPlanned ? 'next' : 'new' }) : ''}
    `,
    onSubmit: (data) => sprintsWrite.close(sprint, String(data.get('openCardsTo') || 'backlog') as OpenCardsTo)
  })
}
