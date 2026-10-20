import { toIso } from '@jiraia/core'
import { z } from 'zod'

import { fieldKindSchema } from '../cards/field.schemas.js'
import { priorityValues } from '../cards/schemas.js'
import type { forms } from '../schema-intake.js'

export type FormRow = typeof forms.$inferSelect

/**
 * Where an answer goes on the card: a standard field, or a custom field of the space (`field:<id>`).
 * Several questions may go to the description — each becomes a section of it, under its label.
 */
export const formTargetSchema = z.union([
  z.enum(['title', 'description', 'priority', 'dueDate']),
  z.string().regex(/^field:[0-9a-f-]{36}$/)
])
export type FormTarget = z.infer<typeof formTargetSchema>

export const formQuestionSchema = z.object({
  /** Stable within the form: the key of its answer. */
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().trim().min(1).max(200),
  help: z.string().max(500).default(''),
  required: z.boolean().default(false),
  target: formTargetSchema
})
export type FormQuestion = z.infer<typeof formQuestionSchema>

export const formInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2_000).default(''),
    typeId: z.uuid(),
    stateId: z.uuid().nullable().default(null),
    labels: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    questions: z.array(formQuestionSchema).min(1).max(30),
    enabled: z.boolean().default(true)
  })
  .refine((input) => input.questions.filter((question) => question.target === 'title').length === 1, {
    message: 'Exactly one question fills the title'
  })
  .refine((input) => new Set(input.questions.map((question) => question.id)).size === input.questions.length, {
    message: 'Each question needs its own id'
  })
export type FormInput = z.infer<typeof formInputSchema>

/** How the screen draws a question: the kind of input and, for a choice, its options. */
export const formInputKindSchema = z.union([z.enum(['text', 'long_text', 'priority']), fieldKindSchema])
export const formQuestionViewSchema = formQuestionSchema.extend({
  kind: formInputKindSchema,
  options: z.array(z.string())
})
export type FormQuestionView = z.infer<typeof formQuestionViewSchema>

export const formViewSchema = z.object({
  id: z.uuid(),
  space: z.object({ id: z.uuid(), key: z.string(), name: z.string() }),
  name: z.string(),
  description: z.string(),
  typeId: z.uuid(),
  stateId: z.uuid().nullable(),
  labels: z.array(z.string()),
  questions: z.array(formQuestionViewSchema),
  enabled: z.boolean(),
  updatedAt: z.iso.datetime()
})
export type FormView = z.infer<typeof formViewSchema>
export const formListSchema = z.object({ items: z.array(formViewSchema) })

/** The answers, by question id: text, a number, a date, a choice or several. */
export const submissionSchema = z.object({ answers: z.record(z.string(), z.unknown()) })
export const submissionResultSchema = z.object({
  card: z.object({ id: z.uuid(), key: z.string(), title: z.string() })
})

export const formPathSchema = z.object({ formId: z.uuid() })

export const PRIORITY_OPTIONS: readonly string[] = priorityValues

export const questionsOf = (row: FormRow): FormQuestion[] => z.array(formQuestionSchema).parse(row.fields)

export const toFormView = (
  row: FormRow,
  space: FormView['space'],
  describe: (question: FormQuestion) => Pick<FormQuestionView, 'kind' | 'options'>
): FormView => ({
  id: row.id,
  space,
  name: row.name,
  description: row.description,
  typeId: row.typeId,
  stateId: row.stateId,
  labels: z.array(z.string()).parse(row.labels),
  questions: questionsOf(row).map((question) => ({ ...question, ...describe(question) })),
  enabled: row.enabled,
  updatedAt: toIso(row.updatedAt)
})
