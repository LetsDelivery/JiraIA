import { describe, expect, it } from 'bun:test'

import { requiredKeys } from '../config-keys.js'

describe('requiredKeys', () => {
  it('reads the keys of a schema nested inside z.intersection', () => {
    // Regression: only keys at two spaces were read, so `work`'s config — four spaces deep — gave
    // none, and the config gate passed a template missing REALTIME_URL.
    const source = [
      'const configSchema = z.intersection(',
      '  dbConfigSchema,',
      '  z.object({',
      '    ATTACHMENTS_BUCKET: z.string().min(3),',
      '    REALTIME_URL: z.string().regex(/^wss?:\\/\\//),',
      '    WEB_URL: z.url().optional()',
      '  })',
      ')'
    ].join('\n')

    expect(requiredKeys(source)).toEqual(['ATTACHMENTS_BUCKET', 'REALTIME_URL'])
  })

  it('reads a definition that spans lines whole', () => {
    const source =
      'z.object({\n  DOMAIN: z\n    .string()\n    .min(3),\n  LEVEL: z\n    .string()\n    .default("info")\n})'

    expect(requiredKeys(source)).toEqual(['DOMAIN'])
  })

  it('leaves out what the Lambda runtime sets by itself', () => {
    expect(requiredKeys('z.object({\n  AWS_REGION: z.string(),\n  TABLE: z.string()\n})')).toEqual(['TABLE'])
  })
})
