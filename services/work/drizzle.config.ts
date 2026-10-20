import { defineConfig } from 'drizzle-kit'

/** `bun run db:generate` writes this service's migrations from `src/schema*.ts` (ADR-0002). */
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './services/work/src/schema.ts',
    './services/work/src/schema-intake.ts',
    './services/work/src/schema-agents.ts'
  ],
  out: './services/work/drizzle',
  schemaFilter: ['work']
})
