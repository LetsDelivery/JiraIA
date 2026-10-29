import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { systemClock, toIso, uuidGenerator } from '@jiraia/core'
import { connectDatabase, type Database } from '@jiraia/db'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import { z } from 'zod'
import {
  type AttachmentFiles,
  DiskAttachmentFiles,
  S3AttachmentFiles
} from '../../services/work/src/import/attachment-files.js'
import { ConfluenceRawCopy, type ConfluenceReport } from '../../services/work/src/import/confluence-raw-copy.js'
import { HttpAtlassianSource } from '../../services/work/src/import/http-atlassian-source.js'
import { HttpConfluenceSource } from '../../services/work/src/import/http-confluence-source.js'
import { ImportRepository } from '../../services/work/src/import/import.repository.js'
import { S3ImportStore } from '../../services/work/src/import/import-store.js'
import { JiraAttachmentCopy } from '../../services/work/src/import/jira-attachment-copy.js'
import { JiraImport, type JiraImportReport } from '../../services/work/src/import/jira-import.js'
import { JiraRawCopy, type JiraReport } from '../../services/work/src/import/jira-raw-copy.js'
import { type Person, peopleFromCsv, peopleToCsv } from '../../services/work/src/import/people.js'
import { PEOPLE_MAPPING, PeopleScan } from '../../services/work/src/import/people-scan.js'

/**
 * The migration's raw copy (Etapa 8a, ADR-0036), run from a terminal with the AWS profile of the
 * account — `lets-dev` by default:
 *
 *     bun run import:atlassian -- jira [--only TEC,REQ] [--previous <run>] [--run <id>]
 *     bun run import:atlassian -- jira-attachments --run <id>
 *     bun run import:atlassian -- confluence [--only CS,Produto] [--run <id>]
 *     bun run import:atlassian -- people --jira-run <id> --confluence-run <id>
 *     bun run import:atlassian -- people-accept <reviewed.csv>
 *     bun run import:atlassian -- jira-import --raw-run <id> --as <email> [--only TEC,PRD] [--run <id>]
 *
 * Reads the read-only tokens from the secret `jiraia/atlassian`, copies as it is to
 * `s3://<bucket>/import/<run>/`, prints the reconciliation and exits 1 when something is missing or a
 * count differs. `jira --previous` asks Jira only for what changed; `jira-attachments` stores the bytes
 * of every attachment of a run, each once, by its id. `people` proposes who each account becomes and
 * writes a CSV to review outside the repository (it holds e-mails); `people-accept` stores the
 * reviewed one for 8c. `jira-import` writes a raw Jira copy into the database — the local one when
 * `DATABASE_URL` is set, otherwise the account's Aurora, found in the `jiraia` function's settings.
 */
const PROJECTS = 'TEC,MARKETING,PRD,ORQ,TASK,PERF,JUR,SDDEC,REQ,OLS,MS,LP,FIB,GB'.split(',')
const SPACES = 'BA,Produto,LD,CS,CSB,DEMO,team9e949cb32355422b970994e76dcc60a1,PERF'.split(',')
const USAGE = `usage:
  bun run import:atlassian -- jira [--only TEC,REQ] [--previous <run>] [--run <id>]
  bun run import:atlassian -- jira-attachments --run <id>
  bun run import:atlassian -- confluence [--only CS,Produto] [--run <id>]
  bun run import:atlassian -- people --jira-run <id> --confluence-run <id>
  bun run import:atlassian -- people-accept <reviewed.csv>
  bun run import:atlassian -- jira-import --raw-run <id> --as <email> [--only TEC,PRD] [--run <id>]`
const REVIEW_DIR = join(homedir(), 'Documents/lets-workspace/jiraia-migracao/people')

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
    secret: { type: 'string', default: 'jiraia/atlassian' },
    'jira-run': { type: 'string' },
    'confluence-run': { type: 'string' },
    directory: { type: 'string', default: 'backups/2026-10-28/jira-export-users.csv' },
    'raw-run': { type: 'string' },
    as: { type: 'string' }
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
  console.error()
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
const incomplete =
  (step === 'jira-attachments' && !values.run) ||
  (step === 'people' && !(values['jira-run'] && values['confluence-run'])) ||
  (step === 'people-accept' && !positionals[1]) ||
  (step === 'jira-import' && !(values['raw-run'] && values.as && values.only))
const STEPS = ['jira', 'jira-attachments', 'confluence', 'people', 'people-accept', 'jira-import']
if (!STEPS.includes(step) || incomplete) {
  console.error(USAGE)
  process.exit(2)
}

const byRule = (people: Person[]) =>
  Object.entries(Object.groupBy(people, (person) => person.rule))
    .map(([rule, rows]) => `${rule} ${rows?.length ?? 0}`)
    .join(', ')

/**
 * The local database and disk when `DATABASE_URL` is set; otherwise the Aurora and the attachments
 * bucket the `jiraia` function uses, read from its settings.
 */
const openTarget = (importBucket: string): { db: Database; files: AttachmentFiles } => {
  if (process.env.DATABASE_URL) {
    const root = process.env.LOCAL_FILES_DIR ?? '.local-files/8280'
    return {
      db: connectDatabase({ DATABASE_URL: process.env.DATABASE_URL }),
      files: new DiskAttachmentFiles({ importBucket, root, region: 'us-east-1' })
    }
  }
  const args = ['lambda', 'get-function-configuration', '--function-name', 'jiraia', '--region', 'us-east-1']
  const output = execFileSync('aws', [...args, '--query', 'Environment.Variables', '--output', 'json'], {
    env: { AWS_PROFILE: 'lets-dev', ...process.env }
  })
  const env = z
    .object({
      DB_CLUSTER_ARN: z.string(),
      DB_SECRET_ARN: z.string(),
      DB_NAME: z.string(),
      ATTACHMENTS_BUCKET: z.string()
    })
    .parse(JSON.parse(output.toString()))
  return {
    db: connectDatabase(env, { waitMs: () => 60_000 }),
    files: new S3AttachmentFiles({ importBucket, attachmentsBucket: env.ATTACHMENTS_BUCKET, region: 'us-east-1' })
  }
}

/** What one space's import found worth a look: collisions, reconciled workflow, parents elsewhere. */
const printNotes = (space: JiraImportReport['spaces'][number]) => {
  const notes = [
    space.cards.conflicts.length > 0
      ? `number already used by a card not from Jira: ${space.cards.conflicts.join(', ')}`
      : '',
    space.workflow.removed.length > 0 ? `not in Jira, removed: ${space.workflow.removed.join(', ')}` : '',
    space.workflow.kept.length > 0 ? `not in Jira, kept off the board: ${space.workflow.kept.join(', ')}` : '',
    space.parentsOutside.length > 0 ? `parent in another project (not linked): ${space.parentsOutside.length}` : ''
  ]
  for (const note of notes.filter(Boolean)) {
    console.error(`  ${note}`)
  }
}

const printImport = (report: JiraImportReport) => {
  const { links } = report
  console.error(`run ${report.run} from ${report.rawRun}`)
  console.error(
    `links: +${links.inserted} =${links.unchanged}, waiting for a project not imported yet: ${links.waiting}`
  )
  for (const s of report.spaces) {
    const cards = `cards +${s.cards.inserted} ~${s.cards.updated} =${s.cards.unchanged}`
    const comments = `comments +${s.comments.inserted} ~${s.comments.updated} =${s.comments.unchanged}`
    const files = `attachments +${s.attachments.inserted} (${mb(s.attachments.bytes)} MB)`
    console.error(`${s.key}: ${cards}, ${comments}, ${files}, aliases ${s.aliases}`)
    printNotes(s)
  }
  if (report.unmappedAccounts.length > 0) {
    console.error(`accounts not in the reviewed mapping, imported as inactive: ${report.unmappedAccounts.length}`)
  }
}

if (step === 'jira-import') {
  const { db, files } = openTarget(values.bucket)
  const actor = await new ImportRepository(db).actor(values.as ?? '')
  if (!actor) {
    console.error(`No member "${values.as}" in that database`)
    process.exit(1)
  }
  const store = new S3ImportStore({ bucket: values.bucket, region: 'us-east-1' })
  const logger = createLogger('work', 'import')
  const report = await new JiraImport({ db, store, files, clock: systemClock, ids: uuidGenerator, logger }).run({
    organizationId: actor.organizationId,
    actorId: actor.memberId,
    rawRun: values['raw-run'] ?? '',
    run: values.run ?? toIso(systemClock.now()).replace(/[:.]/g, '-'),
    projects: (values.only ?? '').split(',')
  })
  printImport(report)
  process.exit(report.spaces.every((space) => space.cards.conflicts.length === 0) ? 0 : 1)
}

if (step === 'people-accept') {
  const people = peopleFromCsv(readFileSync(positionals[1] ?? '', 'utf8'))
  await new S3ImportStore({ bucket: values.bucket, region: 'us-east-1' }).putJson(PEOPLE_MAPPING, people)
  console.error(`${people.length} accounts stored in s3://${values.bucket}/${PEOPLE_MAPPING} (${byRule(people)})`)
  process.exit(0)
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

if (step === 'people') {
  const scan = new PeopleScan({ source: new HttpAtlassianSource(http, credentials), store, logger })
  const people = await scan.run({
    jiraRun: values['jira-run'] ?? '',
    confluenceRun: values['confluence-run'] ?? '',
    directoryKey: values.directory
  })
  const file = join(REVIEW_DIR, 'proposal.csv')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${peopleToCsv(people)}\n`, { mode: 0o600 })
  console.error(`${people.length} accounts (${byRule(people)}); review ${file}, then people-accept it`)
  process.exit(0)
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
