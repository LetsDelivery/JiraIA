/**
 * Creates the organization and its first admin in a deployed account, once, after the first deploy
 * (`bootstrapOrganization`). The admin then signs in with Google and is recognised by their address;
 * everyone else is invited, or signs in and reads, from there.
 *
 * Talks to Aurora through the Data API with your own AWS credentials, as the Lambdas do (ADR-0002):
 *
 *     AWS_PROFILE=lets-dev AWS_REGION=us-east-1 \
 *     DB_CLUSTER_ARN=<stack's DatabaseCluster> DB_SECRET_ARN=<stack's DatabaseSecret> \
 *     bun run aws:bootstrap --admin-email ana@uselets.com --admin-name "Ana Lima"
 *
 * It refuses when an organization already exists, so a second run cannot mint a second admin.
 */

import { parseArgs } from 'node:util'

import { readEnv, systemClock, uuidGenerator } from '@jiraia/core'
import { connectDatabase } from '@jiraia/db'
import { z } from 'zod'

import { bootstrapOrganization } from '../../services/work/src/members/bootstrap.js'
import { isAllowedAddress } from '../../services/work/src/members/domains.js'

const envSchema = z.object({
  DB_CLUSTER_ARN: z.string().startsWith('arn:aws:rds:'),
  DB_SECRET_ARN: z.string().startsWith('arn:aws:secretsmanager:'),
  DB_NAME: z.string().min(1).default('jiraia'),
  ALLOWED_EMAIL_DOMAINS: z.string().default('uselets.com,lets.delivery')
})

const { values } = parseArgs({
  options: {
    'admin-email': { type: 'string' },
    'admin-name': { type: 'string' },
    organization: { type: 'string', default: "LET'S" }
  }
})

const env = readEnv(envSchema, process.env)
const domains = env.ALLOWED_EMAIL_DOMAINS.split(',').map((domain) => domain.trim().toLowerCase())
const email = (values['admin-email'] ?? '').trim().toLowerCase()
const name = (values['admin-name'] ?? '').trim()

if (!isAllowedAddress(email, domains) || !name) {
  console.error(`Give --admin-email of ${domains.join(' or ')} and --admin-name; got "${email}" and "${name}"`)
  process.exit(1)
}

const db = connectDatabase({
  DB_CLUSTER_ARN: env.DB_CLUSTER_ARN,
  DB_SECRET_ARN: env.DB_SECRET_ARN,
  DB_NAME: env.DB_NAME
})
const admin = await bootstrapOrganization(
  { db, clock: systemClock, ids: uuidGenerator },
  { organizationName: values.organization ?? "LET'S", admin: { email, name } }
)

console.error(`Organization "${values.organization}" created; ${admin.email} is its admin and may now sign in.`)
