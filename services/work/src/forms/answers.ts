import { ValidationException } from '@jiraia/core'
import { z } from 'zod'

import type { CreateCard, Priority } from '../cards/schemas.js'
import { prioritySchema } from '../cards/schemas.js'
import type { FormQuestion } from './schemas.js'

/** What a set of answers becomes: the card's standard fields and its custom values. */
export type CardFromForm = {
  title: string
  description: string
  priority: Priority
  dueDate: string | null
  customFields: Record<string, unknown>
}

const _empty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0)

/** A required question left empty is refused, naming it. */
const _assertAnswered = (questions: readonly FormQuestion[], answers: Record<string, unknown>): void => {
  const missing = questions.filter((question) => question.required && _empty(answers[question.id]))
  if (missing.length > 0) {
    throw new ValidationException(`Answer "${missing[0]?.label}" before sending`, { questionId: missing[0]?.id ?? '' })
  }
}

/**
 * The answers as a card. Questions to the description become its sections, each under its label, in
 * the form's order — the way a request reads when it arrives.
 *
 * @example cardFromAnswers([{ id: 't', target: 'title', … }], { t: 'Exportar faturas' }).title   // 'Exportar faturas'
 */
export const cardFromAnswers = (questions: readonly FormQuestion[], answers: Record<string, unknown>): CardFromForm => {
  _assertAnswered(questions, answers)
  const card: CardFromForm = { title: '', description: '', priority: 'medium', dueDate: null, customFields: {} }
  const sections: string[] = []
  for (const question of questions.filter((each) => !_empty(answers[each.id]))) {
    _apply(card, sections, question, answers[question.id])
  }
  card.description = sections.join('\n\n')
  return card
}

const _apply = (card: CardFromForm, sections: string[], question: FormQuestion, value: unknown): void => {
  const target = question.target
  if (target === 'title') {
    card.title = String(value).trim().slice(0, 255)
  } else if (target === 'description') {
    sections.push(`**${question.label}**\n${String(value).trim()}`)
  } else if (target === 'priority') {
    card.priority = prioritySchema.parse(value)
  } else if (target === 'dueDate') {
    card.dueDate = _date(question, value)
  } else {
    card.customFields[target.slice('field:'.length)] = value
  }
}

const _date = (question: FormQuestion, value: unknown): string => {
  const parsed = z.iso.date().safeParse(value)
  if (!parsed.success) {
    throw new ValidationException(`"${question.label}" takes a date such as 2026-11-30`, { questionId: question.id })
  }
  return parsed.data
}

export const toCreateCard = (
  card: CardFromForm,
  form: { typeId: string; stateId: string | null; labels: string[] }
): CreateCard => ({
  title: card.title,
  description: card.description,
  priority: card.priority,
  labels: form.labels,
  typeId: form.typeId,
  ...(form.stateId ? { stateId: form.stateId } : {})
})
