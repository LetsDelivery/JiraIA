import type { Database } from '@jiraia/db'
import { and, asc, eq } from 'drizzle-orm'

import { forms } from '../schema-intake.js'
import type { FormRow } from './schemas.js'

export class FormRepository {
  constructor(private readonly db: Database) {}

  async list(spaceId: string): Promise<FormRow[]> {
    return await this.db.select().from(forms).where(eq(forms.spaceId, spaceId)).orderBy(asc(forms.createdAt))
  }

  async find(organizationId: string, id: string): Promise<FormRow | undefined> {
    const [row] = await this.db
      .select()
      .from(forms)
      .where(and(eq(forms.organizationId, organizationId), eq(forms.id, id)))
    return row
  }

  async insert(tx: Database, row: FormRow): Promise<void> {
    await tx.insert(forms).values(row)
  }

  async update(tx: Database, id: string, fields: Partial<FormRow>): Promise<void> {
    await tx.update(forms).set(fields).where(eq(forms.id, id))
  }

  async delete(tx: Database, id: string): Promise<void> {
    await tx.delete(forms).where(eq(forms.id, id))
  }
}
