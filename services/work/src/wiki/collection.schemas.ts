import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { DrawSpaceWithCreator } from '../draw/draw-space.schemas.js'
import type { wikiCollections } from '../schema-wiki.js'

export type CollectionRow = typeof wikiCollections.$inferSelect

/** The outline a new page of the collection starts from: the customer's, or none (ADR-0033). */
export const outlineSchema = z.enum(['customer'])
export type Outline = z.infer<typeof outlineSchema>

/**
 * Who reads a collection (ADR-0034): everyone at LET’S, only who holds a role in it, or one member and
 * whoever they invite. A personal collection is made by the wiki, never chosen.
 */
export const accessSchema = z.enum(['organization', 'restricted', 'personal'])
export type CollectionAccessKind = z.infer<typeof accessSchema>
const chosenAccessSchema = z.enum(['organization', 'restricted'])

const nameSchema = z.string().trim().min(1).max(80)
const iconSchema = z.string().trim().min(1).max(8)
/** From a month to a year: shorter turns review into noise, longer lets a page rot. */
const reviewDaysSchema = z.number().int().min(30).max(365)

export const createCollectionSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).default(''),
  icon: iconSchema.default('📚'),
  reviewDays: reviewDaysSchema.default(90),
  outline: outlineSchema.nullable().default(null),
  access: chosenAccessSchema.default('organization')
})
export type CreateCollection = z.infer<typeof createCollectionSchema>

export const updateCollectionSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().max(500).optional(),
    icon: iconSchema.optional(),
    reviewDays: reviewDaysSchema.optional(),
    outline: outlineSchema.nullable().optional(),
    access: chosenAccessSchema.optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), { message: 'Send at least one field' })
export type UpdateCollection = z.infer<typeof updateCollectionSchema>

export const collectionPathSchema = z.object({ collectionId: z.uuid() })

const personSchema = z.object({ id: z.uuid(), name: z.string() })

/** How much a collection holds and how much of it can be trusted, for "Todas as coleções". */
export const collectionStatsSchema = z.object({
  pages: z.number().int(),
  official: z.number().int(),
  overdue: z.number().int(),
  /** People holding a role in it, directly or through a group. */
  people: z.number().int()
})
export type CollectionStats = z.infer<typeof collectionStatsSchema>
export const EMPTY_STATS: CollectionStats = { pages: 0, official: 0, overdue: 0, people: 0 }

export const collectionViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  reviewDays: z.number().int(),
  outline: outlineSchema.nullable(),
  access: accessSchema,
  /** For a personal collection, the member it belongs to. */
  personalOwner: personSchema.nullable(),
  createdBy: personSchema,
  /** Who holds the admin role directly: the collection's owners. */
  owners: z.array(personSchema),
  stats: collectionStatsSchema,
  /** Whether the caller edits its pages: an editor or an owner of it (ADR-0033). */
  canWrite: z.boolean(),
  /** Whether the caller owns it: makes pages official, changes it and gives roles in it. */
  canManage: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type CollectionView = z.infer<typeof collectionViewSchema>
export const collectionListSchema = z.object({ items: z.array(collectionViewSchema) })

export type Person = z.infer<typeof personSchema>
export type CollectionExtras = {
  canWrite: boolean
  canManage: boolean
  owners?: readonly Person[] | undefined
  stats?: CollectionStats | undefined
  personalOwner?: Person | null | undefined
}

export const toCollectionView = (
  space: DrawSpaceWithCreator,
  collection: CollectionRow,
  extras: CollectionExtras
): CollectionView => ({
  id: space.id,
  name: space.name,
  description: space.description,
  icon: space.icon,
  reviewDays: collection.reviewDays,
  outline: collection.outline === null ? null : outlineSchema.parse(collection.outline),
  access: accessSchema.parse(collection.access),
  personalOwner: extras.personalOwner ?? null,
  createdBy: { id: space.createdBy, name: space.creatorName },
  owners: [...(extras.owners ?? [])],
  stats: extras.stats ?? EMPTY_STATS,
  canWrite: extras.canWrite,
  canManage: extras.canManage,
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
