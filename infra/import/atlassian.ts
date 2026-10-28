import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'

import { systemClock, toIso } from '@jiraia/core'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import { z } from 'zod'

import { ConfluenceRawCopy, type ConfluenceReport } from '../../services/work/src/import/confluence-raw-copy.js'
import { HttpAtlassianSource } from '../../services/work/src/import/http-atlassian-source.js'
import { HttpConfluenceSource } from '../../services/work/src/import/http-confluence-source.js'
import { S3ImportStore } from '../../services/work/src/import/import-store.js'
import { JiraAttachmentCopy } from '../../services/work/src/import/jira-attachment-copy.js'
import { JiraRawCopy, type JiraReport } from '../../services/work/src/import/jira-raw-copy.js'

/**
 * The migration's raw copy (Etapa 8a, ADR-0036), run from a terminal with the AWS profile of the
 * account — `lets-dev` by default:
 *
 *     bun run import:atlassian -- jira [--only TEC,REQ] [--previous <run>] [--run <id>]
 *     bun run import:atlassian -- jira-attachments --run <id>
 *     bun run import:atlassian -- confluence [--only CS,Produto] [--run <id>]
 *
 * Reads the read-only tokens from the secret `jiraia/atlassian`, copies as it is to
 * `s3://<bucket>/import/<run>/`, prints the reconciliation and exits 1 when something is missing or a
 * count differs. `jira --previous` asks Jira only for what changed; `jira-attachments` stores the bytes
 * of every attachment of a run, each once, by its id.
 */
const PROJECTS = 'TEC,MARKETING,PRD,ORQ,TASK,PERF,JUR,SDDEC,REQ,OLS,MS,LP,FIB,GB'.split(',')
const SPACES = 'BA,Produto,LD,CS,CSB,DEMO,team9e949cb32355422b970994e76dcc60a1,PERF'.split(',')
const USAGE = `usage:
  bun run import:atlassian -- jira [--only TEC,REQ] [--previous <run>] [--run <id>]
  bun run import:atlassian -- jira-attachments --run <id>
  bun run import:atlassian -- confluence [--only CS,Produto] [--run <id>]`

const secretSchema = z.object({
  cloud_id: z.string(),
  account_email: z.string(),
  jira_token: z.string().min(20),
  jira_token_expires_at: z.string(),
  confluence_token: z.string().min(20),
  confluence_token_expires_at: z.string()
})

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    only: { type: 'string' },
    previous: { type: 'string' },
    run: { type: 'string' },
    bucket: { type: 'string', default: 'jiraia-import' },
    secret: { type: 'string', default: 'jiraia/atlassian' }
  }
})

const readSecret = (id: string) => {
  const args = ['secretsmanager', 'get-secret-value', '--secret-id', id, '--region', 'us-east-1']
  const output = execFileSync('aws', [...args, '--query', 'SecretString', '--output', 'text'], {
    env: { AWS_PROFILE: 'lets-dev', ...process.env }
  })
  return secretSchema.parse(JSON.parse(output.toString()))
}

const row = (cells: (string | number)[]) =>
  cells.map((cell, i) => (i === 0 ? String(cell).padEnd(12) : String(cell).padStart(9))).join('')

const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1)

const printJira = (report: JiraReport) => {
  console.error(`run ${report.run}  ${report.startedAt} → ${report.finishedAt}`)
  console.error(
    row(['project', 'expected', 'copied', 'reused', 'diff', 'comments', 'changes', 'worklogs', 'attach', 'MB', 'links'])
  )
  for (const p of report.projects) {
    console.error(
      row([
        p.key,
        p.expected,
        p.copied,
        p.reused,
        p.difference,
        p.comments,
        p.changes,
        p.worklogs,
        p.attachments,
        mb(p.attachmentBytes),
        p.links
      ])
    )
  }
}

const printConfluence = (report: ConfluenceReport) => {
  console.error(`run ${report.run}  ${report.startedAt} → ${report.finishedAt}`)
  console.error(
    row(['space', 'pages', 'folders', 'boards', 'dbs', 'embeds', 'versions', 'footer', 'inline', 'attach', 'MB'])
  )
  for (const s of report.spaces) {
    console.error(
      row([
        s.key.slice(0, 11),
        s.page,
        s.folder,
        s.whiteboard,
        s.database,
        s.embed,
        `${s.versions}/${s.versionBodies}`,
        s.footerComments,
        s.inlineComments,
        s.attachments,
        mb(s.attachmentBytes)
      ])
    )
  }
}

const expired = (date: string) => date < toIso(systemClock.now()).slice(0, 10)

const step = positionals[0] ?? ''
if (!['jira', 'jira-attachments', 'confluence'].includes(step) || (step === 'jira-attachments' && !values.run)) {
  console.error(USAGE)
  process.exit(2)
}
const secret = readSecret(values.secret)
const app = step === 'confluence' ? 'confluence' : 'jira'
const expiry = app === 'jira' ? secret.jira_token_expires_at : secret.confluence_token_expires_at
if (expired(expiry)) {
  console.error(`The ${app} token expired on ${expiry}; create a new one (docs/migracao-atlassian-acesso.md)`)
  process.exit(1)
}

const logger = createLogger('work', 'import')
const http = createHttpClient({ provider: app, logger })
const credentials = {
  cloudId: secret.cloud_id,
  email: secret.account_email,
  jiraToken: secret.jira_token,
  confluenceToken: secret.confluence_token
}
const store = new S3ImportStore({ bucket: values.bucket, region: 'us-east-1' })
const run = values.run ?? toIso(systemClock.now()).replace(/[:.]/g, '-')
const only = values.only?.split(',')

if (step === 'jira-attachments') {
  const report = await new JiraAttachmentCopy({
    source: new HttpAtlassianSource(http, credentials),
    store,
    logger
  }).run(run)
  console.error(
    `run ${report.run}: ${report.attachments} attachments, ${report.copied} copied (${mb(report.bytes)} MB), ${report.alreadyStored} already stored`
  )
  if (report.sizeMismatch.length > 0) {
    console.error(`size differs from Jira's: ${report.sizeMismatch.join(', ')}`)
  }
  process.exit(report.sizeMismatch.length === 0 ? 0 : 1)
}

if (step === 'confluence') {
  const copy = new ConfluenceRawCopy({
    source: new HttpConfluenceSource(http, credentials),
    store,
    clock: systemClock,
    logger
  })
  const report = await copy.run({ run, spaces: only ?? SPACES })
  printConfluence(report)
  if (report.notVisible.length > 0) {
    console.error(`not visible to the account: ${report.notVisible.join(', ')}`)
  }
  process.exit(report.notVisible.length === 0 ? 0 : 1)
}

const copy = new JiraRawCopy({ source: new HttpAtlassianSource(http, credentials), store, clock: systemClock, logger })
const report = await copy.run({
  run,
  projects: only ?? PROJECTS,
  ...(values.previous ? { previousRun: values.previous } : {})
})
printJira(report)
if (report.notVisible.length > 0) {
  console.error(`not visible to the account: ${report.notVisible.join(', ')}`)
}
process.exit(report.notVisible.length === 0 && report.projects.every((p) => p.difference === 0) ? 0 : 1)
