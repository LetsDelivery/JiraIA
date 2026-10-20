import { parse } from 'yaml'

/**
 * Reads a CloudFormation template without choking on its intrinsic-function tags.
 *
 * `!Sub`, `!Ref`, `!GetAtt` and friends are YAML tags, and a plain parser refuses them. The gates
 * that read these templates care about structure — which functions exist, what environment they
 * declare — and never about what a `!Sub` resolves to, so every tag collapses to its argument.
 */
export type Template = {
  Globals?: { Function?: { Environment?: { Variables?: Record<string, unknown> } } }
  /**
   * CloudFormation ignores template-level `Metadata`, which is what makes it the right place for a
   * gate to read. `jiraia.ssmTargets` is how a template names an SSM parameter it consumes through
   * a stack parameter rather than through `{{resolve:ssm:...}}`.
   */
  Metadata?: { jiraia?: { ssmTargets?: Array<Record<string, string>> } }
  Resources?: Record<
    string,
    {
      Type?: string
      DeletionPolicy?: string
      Properties?: {
        Handler?: unknown
        Environment?: { Variables?: Record<string, unknown> }
        [key: string]: unknown
      }
    }
  >
}

const TAGS = [
  'Ref',
  'Sub',
  'GetAtt',
  'Join',
  'Select',
  'Split',
  'Equals',
  'If',
  'Not',
  'And',
  'Or',
  'FindInMap',
  'Base64',
  'Cidr',
  'ImportValue',
  'GetAZs',
  'Condition'
]

/**
 * Each tag three times over: scalar (`!Ref Table`), sequence (`!Split [',', x]`) and map.
 *
 * The parser matches a tag against the *kind* of node it decorates, so one definition covers only
 * one of the three and the others come back as unresolved warnings.
 */
const CUSTOM_TAGS = TAGS.flatMap((name) => [
  // The argument is what matters; the function it was passed to never is.
  { tag: `!${name}`, resolve: (value: unknown) => value },
  { tag: `!${name}`, collection: 'seq' as const, resolve: (value: unknown) => value },
  { tag: `!${name}`, collection: 'map' as const, resolve: (value: unknown) => value }
])

export const load = (source: string): Template => parse(source, { customTags: CUSTOM_TAGS }) as Template
