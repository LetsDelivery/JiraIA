import { z } from 'zod'

/**
 * How a card type looks (ADR-0031): an icon and a colour from closed sets, which the panel draws in
 * its own icons and in tones that read on the light and the dark theme. Names, not pictures, so the
 * API never carries markup.
 */
export const typeIconValues = [
  'checkbox',
  'bookmark',
  'bug',
  'bolt',
  'bulb',
  'flask',
  'database',
  'palette',
  'subtask',
  'file',
  'target',
  'flag',
  'star',
  'message',
  'rocket',
  'layers'
] as const
export const typeIconSchema = z.enum(typeIconValues)
export type TypeIcon = z.infer<typeof typeIconSchema>

export const typeColorValues = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'] as const
export const typeColorSchema = z.enum(typeColorValues)
export type TypeColor = z.infer<typeof typeColorSchema>

export type TypeLook = { icon: TypeIcon; color: TypeColor }

/** The look of the types spaces start with and Jira's usual ones; any other name starts plain. */
const LOOKS: Record<string, TypeLook> = {
  bug: { icon: 'bug', color: 'red' },
  tarefa: { icon: 'checkbox', color: 'blue' },
  historia: { icon: 'bookmark', color: 'green' },
  epic: { icon: 'bolt', color: 'violet' },
  epico: { icon: 'bolt', color: 'violet' },
  spike: { icon: 'bulb', color: 'yellow' },
  subtarefa: { icon: 'subtask', color: 'teal' },
  ideia: { icon: 'bulb', color: 'yellow' },
  requisicao: { icon: 'file', color: 'blue' },
  oportunidade: { icon: 'target', color: 'orange' },
  data: { icon: 'database', color: 'violet' },
  prototipo: { icon: 'palette', color: 'pink' },
  solicitacao: { icon: 'message', color: 'teal' },
  incidente: { icon: 'flag', color: 'red' }
}

/**
 * The look a type gets from its name when none is chosen.
 *
 * @example lookOf('Bug')      // { icon: 'bug', color: 'red' }
 * @example lookOf('Contrato') // { icon: 'checkbox', color: 'gray' }
 */
export const lookOf = (name: string): TypeLook => LOOKS[plain(name)] ?? { icon: 'checkbox', color: 'gray' }

/** A name without case or accents: "História" and "historia" are the same type. */
const plain = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

const nameSchema = z.string().trim().min(1).max(60)

export const createTypeSchema = z.object({
  name: nameSchema,
  icon: typeIconSchema.optional(),
  color: typeColorSchema.optional()
})
export const updateTypeSchema = z
  .object({ name: nameSchema.optional(), icon: typeIconSchema.optional(), color: typeColorSchema.optional() })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send a name, an icon or a colour'
  })
export const orderTypesSchema = z.object({ typeIds: z.array(z.uuid()).min(1) })
/** A type is deleted by turning everything of it — cards, forms, fields, rules, views — into `moveTo`. */
export const deleteTypeQuerySchema = z.object({ moveTo: z.uuid() })
export const typePathSchema = z.object({ spaceId: z.uuid(), typeId: z.uuid() })

/**
 * The JSON with every `from` id turned into `to`, lists left without repeats — how a deleted type's
 * place in fields, automations and saved views passes to the type its cards went to.
 *
 * @example swapId({ typeIds: ['a', 'b'] }, 'a', 'b') // { typeIds: ['b'] }
 */
export const swapId = (value: unknown, from: string, to: string): unknown => {
  if (value === from) {
    return to
  }
  if (Array.isArray(value)) {
    const swapped = value.map((each) => swapId(each, from, to))
    return swapped.every((each) => typeof each === 'string') ? [...new Set(swapped)] : swapped
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, swapId(each, from, to)]))
  }
  return value
}
