import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { DrawSpaceWithCreator } from '../draw/draw-space.schemas.js'
import type { wikiCollections } from '../schema-wiki.js'

export type CollectionRow = typeof wikiCollections.$inferSelect

/** The outline a new page of the collection starts from: the customer's, or none (ADR-0033). */
export const outlineSchema = z.enum(['customer'])
export type Outline = z.infer<typeof outlineSchema>

const nameSchema = z.string().trim().min(1).max(80)
const iconSchema = z.string().trim().min(1).max(8)
/** From a month to a year: shorter turns review into noise, longer lets a page rot. */
const reviewDaysSchema = z.number().int().min(30).max(365)

export const createCollectionSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).default(''),
  icon: iconSchema.default('📚'),
  reviewDays: reviewDaysSchema.default(90),
  outline: outlineSchema.nullable().default(null)
})
export type CreateCollection = z.infer<typeof createCollectionSchema>

export const updateCollectionSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().max(500).optional(),
    icon: iconSchema.optional(),
    reviewDays: reviewDaysSchema.optional(),
    outline: outlineSchema.nullable().optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), { message: 'Send at least one field' })
export type UpdateCollection = z.infer<typeof updateCollectionSchema>

export const collectionPathSchema = z.object({ collectionId: z.uuid() })

export const collectionViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  reviewDays: z.number().int(),
  outline: outlineSchema.nullable(),
  createdBy: z.object({ id: z.uuid(), name: z.string() }),
  /** Whether the caller edits its pages: an editor or an owner of it (ADR-0033). */
  canWrite: z.boolean(),
  /** Whether the caller owns it: makes pages official, changes it and gives roles in it. */
  canManage: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type CollectionView = z.infer<typeof collectionViewSchema>
export const collectionListSchema = z.object({ items: z.array(collectionViewSchema) })

export const toCollectionView = (
  space: DrawSpaceWithCreator,
  collection: CollectionRow,
  { canWrite, canManage }: { canWrite: boolean; canManage: boolean }
): CollectionView => ({
  id: space.id,
  name: space.name,
  description: space.description,
  icon: space.icon,
  reviewDays: collection.reviewDays,
  outline: collection.outline === null ? null : outlineSchema.parse(collection.outline),
  createdBy: { id: space.createdBy, name: space.creatorName },
  canWrite,
  canManage,
  createdAt: toIso(space.createdAt),
  updatedAt: toIso(space.updatedAt)
})

/** The customer outline (docs/produto/wiki.md): knowledge only — contracts and prices stay in Drive. */
export const CUSTOMER_OUTLINE = [
  '## Resumo',
  'O que é, segmento, desde quando é cliente.',
  '## Operação',
  'Como opera conosco, janelas, regras especiais.',
  '## Combinados',
  'SLA e acordos, cada um com data e quem decidiu.',
  '## Atenção',
  'O que costuma dar problema e como resolver.',
  '## Contatos',
  'Cargo e canal corporativo. Sem telefone, e-mail ou documento pessoal.',
  '## Links',
  'Pasta do cliente no Drive (contrato, preço), cards no JiraIA, páginas no Draw.',
  '## Histórico',
  'Decisões importantes, com data.'
].join('\n\n')
