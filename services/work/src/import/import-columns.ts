import type { IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { z } from 'zod'

import { boardColumns, workflowStates } from '../schema.js'

/**
 * A Jira board's columns, captured from the board's configuration into the raw copy as `boards.json`:
 * the agile API that answers it refuses the importer's scoped token, so it is read once by hand.
 */
export const jiraBoardSchema = z.object({
  project: z.string(),
  board: z.object({ id: z.number(), name: z.string() }),
  columns: z.array(z.object({ name: z.string(), statuses: z.array(z.string()) }))
})
export type JiraBoard = z.infer<typeof jiraBoardSchema>
export type WantedColumn = { name: string; statuses: string[] }

/**
 * The columns a project's board shows (ADR-0037): its Jira board's, or — for a project without one, as
 * a business project — one per status of the issue types the board draws, in Jira's order.
 */
export const wantedColumns = (board: JiraBoard | undefined, boardStates: string[]): WantedColumn[] =>
  board ? board.columns : boardStates.map((name) => ({ name, statuses: [name] }))

type Deps = { db: Database; ids: IdGenerator }

/**
 * Etapa 8c: makes a space's board columns exactly the ones wanted, by name — a column Jira's board
 * lacks is removed — and puts each state in its column; every other state of the space leaves the
 * board. Running it again changes nothing.
 */
export class ImportColumns {
  constructor(private readonly deps: Deps) {}

  /** Whether the space's board already has columns. */
  async drawn(spaceId: string): Promise<boolean> {
    const found = await this.deps.db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.spaceId, spaceId))
      .limit(1)
    return found.length > 0
  }

  async apply(spaceId: string, wanted: WantedColumn[], at: Date): Promise<void> {
    const existing = await this.deps.db.select().from(boardColumns).where(eq(boardColumns.spaceId, spaceId))
    const byName = new Map(existing.map((column) => [column.name, column.id]))
    await this.deps.db.transaction(async (tx) => {
      for (const [position, column] of wanted.entries()) {
        await this.place(tx, { spaceId, column, position, at, id: byName.get(column.name) })
      }
      const placed = wanted.flatMap((column) => column.statuses)
      const kept = wanted.map((column) => column.name)
      await tx
        .update(workflowStates)
        .set({ columnId: null })
        .where(
          and(
            eq(workflowStates.spaceId, spaceId),
            placed.length > 0 ? notInArray(workflowStates.name, placed) : undefined
          )
        )
      await tx
        .delete(boardColumns)
        .where(
          and(eq(boardColumns.spaceId, spaceId), kept.length > 0 ? notInArray(boardColumns.name, kept) : undefined)
        )
    })
  }

  /** One column where Jira has it, with its states in it. */
  private async place(
    tx: Database,
    input: { spaceId: string; column: WantedColumn; position: number; at: Date; id: string | undefined }
  ) {
    const id = input.id ?? this.deps.ids.next()
    const row = { id, spaceId: input.spaceId, name: input.column.name, position: input.position, createdAt: input.at }
    await this.upsertColumn(tx, row, input.id !== undefined)
    if (input.column.statuses.length > 0) {
      await tx
        .update(workflowStates)
        .set({ columnId: id })
        .where(and(eq(workflowStates.spaceId, input.spaceId), inArray(workflowStates.name, input.column.statuses)))
    }
  }

  private async upsertColumn(tx: Database, row: typeof boardColumns.$inferInsert, exists: boolean): Promise<void> {
    if (exists) {
      await tx
        .update(boardColumns)
        .set({ position: row.position })
        .where(eq(boardColumns.id, String(row.id)))
    } else {
      await tx.insert(boardColumns).values(row)
    }
  }
}
