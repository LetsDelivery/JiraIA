import { ValidationException } from '@jiraia/core'
import { z } from 'zod'

import type { customFields } from '../schema.js'

export type FieldRow = typeof customFields.$inferSelect

/** The kinds a custom field can be (escopo-mvp 2.5). */
export const fieldKindValues = ['text', 'number', 'date', 'select', 'multi_select', 'person', 'url'] as const
export const fieldKindSchema = z.enum(fieldKindValues)
export type FieldKind = z.infer<typeof fieldKindSchema>

const optionsSchema = z.array(z.string().trim().min(1).max(60)).max(100)

export const fieldViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: fieldKindSchema,
  options: z.array(z.string()),
  typeIds: z.array(z.uuid()),
  position: z.number().int()
})
export type FieldView = z.infer<typeof fieldViewSchema>
export const fieldListSchema = z.object({ items: z.array(fieldViewSchema) })

/** A selection needs its options; the other kinds take none. An empty `typeIds` means every type. */
export const createFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: fieldKindSchema,
    options: optionsSchema.default([]),
    typeIds: z.array(z.uuid()).default([])
  })
  .refine((input) => !_isSelection(input.kind) || input.options.length > 0, {
    message: 'A selection field needs at least one option',
    path: ['options']
  })
export type CreateField = z.infer<typeof createFieldSchema>

/** The kind is fixed once cards hold values of it; the name, options and types can change. */
export const updateFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    options: optionsSchema.optional(),
    typeIds: z.array(z.uuid()).optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one thing to change'
  })
export type UpdateField = z.infer<typeof updateFieldSchema>

export const fieldPathSchema = z.object({ spaceId: z.uuid(), fieldId: z.uuid() })

const _isSelection = (kind: FieldKind): boolean => kind === 'select' || kind === 'multi_select'

export const toFieldView = (row: FieldRow): FieldView => ({
  id: row.id,
  name: row.name,
  kind: fieldKindSchema.parse(row.kind),
  options: z.array(z.string()).parse(row.options),
  typeIds: z.array(z.uuid()).parse(row.typeIds),
  position: row.position
})

const VALUE_SCHEMAS: Record<FieldKind, z.ZodType> = {
  text: z.string().trim().max(2_000),
  number: z.number(),
  date: z.iso.date(),
  select: z.string(),
  multi_select: z.array(z.string()).max(100),
  person: z.uuid(),
  url: z.url({ protocol: /^https?$/ }).max(2_000)
}

/**
 * A value as the field's kind holds it, or a refusal that names the field. `null` clears the field.
 * A selection's value must be one of its options; a person is checked against the members elsewhere.
 *
 * @example parseFieldValue({ name: 'Squad', kind: 'select', options: ['Core'] }, 'Core')   // 'Core'
 * @example parseFieldValue({ name: 'Squad', kind: 'select', options: ['Core'] }, 'X')      // throws
 */
export const parseFieldValue = (field: Pick<FieldView, 'name' | 'kind' | 'options'>, value: unknown): unknown => {
  if (value === null) {
    return null
  }
  const parsed = VALUE_SCHEMAS[field.kind].safeParse(value)
  const chosen = parsed.success && _isSelection(field.kind) ? [parsed.data].flat() : []
  const unknownOption = chosen.find((option) => !field.options.includes(String(option)))

  if (!parsed.success || unknownOption !== undefined) {
    throw new ValidationException(`Field "${field.name}" does not take ${JSON.stringify(value)}`, {
      field: field.name,
      kind: field.kind
    })
  }
  return field.kind === 'multi_select' ? [...new Set(parsed.data as string[])] : parsed.data
}
