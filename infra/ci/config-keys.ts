/**
 * Variables the Lambda runtime sets by itself.
 *
 * A template that also set them would be refused by CloudFormation, so a config schema that asks
 * for one is satisfied without the template saying anything.
 */
export const PROVIDED = new Set([
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_LAMBDA_FUNCTION_VERSION',
  'AWS_LAMBDA_LOG_GROUP_NAME',
  'AWS_LAMBDA_LOG_STREAM_NAME',
  'AWS_EXECUTION_ENV',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN'
])

/** A key of the schema, at any indentation: `work` nests its object inside `z.intersection`. */
const KEY = /^\s+([A-Z][A-Z0-9_]*):/gm

const _optional = (definition: string): boolean =>
  definition.includes('.optional()') || definition.includes('.default(')

/**
 * Every key in a config schema's source that has no `.optional()` and no `.default(`, read up to the
 * next key, so a definition that spans lines is read whole.
 *
 * @example requiredKeys('z.object({\n  A: z.string(),\n  B: z.string().optional()\n})')   // ['A']
 */
export const requiredKeys = (source: string): string[] => {
  const body = source.slice(source.indexOf('z.object({'))
  const keys = [...body.matchAll(KEY)]

  return keys
    .filter((match, index) => !_optional(body.slice(match.index, keys[index + 1]?.index ?? body.length)))
    .map((match) => match[1] as string)
    .filter((key) => !PROVIDED.has(key))
}
