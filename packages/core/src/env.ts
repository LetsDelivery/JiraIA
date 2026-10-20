import type { z } from 'zod'

import { ValidationException } from './exception.js'

/**
 * Reads and validates configuration once, at module load, against a zod schema.
 *
 * Failing at load rather than at first use is the point: a missing table name should
 * kill the cold start with a message naming the variable, not surface as a
 * ResourceNotFoundException on a request an hour later.
 *
 * @example
 * const configSchema = z.object({ TABLE_NAME: z.string().min(1) })
 * export const config = readEnv(configSchema, process.env)
 */
export const readEnv = <TSchema extends z.ZodType>(schema: TSchema, source: NodeJS.ProcessEnv): z.infer<TSchema> => {
  const result = schema.safeParse(source)

  if (!result.success) {
    const missing = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new ValidationException(`Invalid environment: ${missing.join('; ')}`, { issues: missing })
  }

  return result.data
}
