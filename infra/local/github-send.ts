import { createHash, createHmac, randomUUID } from 'node:crypto'

import { LOCAL_PORT } from './config.js'
import { LOCAL_GITHUB_WEBHOOK_SECRET } from './github.js'

/**
 * GitHub's deliveries, played against `bun run local:serve` (Etapa 9), signed as GitHub signs them:
 *
 *     bun run local:github -- branch feat/REQ-1-frete
 *     bun run local:github -- pr open 7 feat/REQ-1-frete "REQ-1 Frete por região"
 *     bun run local:github -- review 7 approved
 *     bun run local:github -- checks feat/REQ-1-frete failure
 *     bun run local:github -- pr merge 7 feat/REQ-1-frete "REQ-1 Frete por região"
 *
 * The installation is `LOCAL_GITHUB_INSTALLATION` (1 by default: complete the local installation with
 * that id first) and the repository `LetsDelivery/jiraia-local`, whose default branch is `master`.
 */
const installation = { id: Number(process.env.LOCAL_GITHUB_INSTALLATION ?? 1) }
const repository = {
  full_name: 'LetsDelivery/jiraia-local',
  html_url: 'https://github.com/LetsDelivery/jiraia-local',
  default_branch: 'master'
}
const sender = { login: 'dev-local' }
/** A branch's head commit, the same every time for the same name, so `checks` finds the pull request. */
const shaOf = (branch: string) => createHash('sha1').update(branch).digest('hex')

const pull = (action: string, number: string, branch: string, title: string) => ({
  action: action === 'merge' ? 'closed' : action,
  pull_request: {
    number: Number(number),
    title,
    html_url: `${repository.html_url}/pull/${number}`,
    state: action === 'merge' || action === 'close' ? 'closed' : 'open',
    draft: action === 'draft',
    merged: action === 'merge',
    merged_at: action === 'merge' ? new Date().toISOString() : null,
    user: sender,
    head: { ref: branch, sha: shaOf(branch) },
    base: { ref: repository.default_branch }
  },
  repository,
  installation
})

const DELIVERIES: Record<string, (args: string[]) => [string, unknown]> = {
  branch: ([ref = '']) => ['create', { ref, ref_type: 'branch', repository, installation, sender }],
  'delete-branch': ([ref = '']) => ['delete', { ref, ref_type: 'branch', repository, installation, sender }],
  pr: ([action = 'open', number = '1', branch = '', title = '']) => [
    'pull_request',
    pull(action === 'open' ? 'opened' : action, number, branch, title)
  ],
  review: ([number = '1', state = 'approved']) => [
    'pull_request_review',
    { action: 'submitted', review: { state }, pull_request: { number: Number(number) }, repository, installation }
  ],
  checks: ([branch = '', conclusion = 'success']) => [
    'check_suite',
    { action: 'completed', check_suite: { head_sha: shaOf(branch), conclusion }, repository, installation }
  ]
}

const [kind = '', ...args] = process.argv.slice(2)
const build = DELIVERIES[kind]
if (!build) {
  console.error(`Unknown delivery "${kind}"; one of: ${Object.keys(DELIVERIES).join(', ')}`)
  process.exit(1)
}
const [event, payload] = build(args)
const body = JSON.stringify(payload)
const response = await fetch(`http://localhost:${LOCAL_PORT}/work/github/events`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-github-event': event,
    'x-github-delivery': randomUUID(),
    'x-hub-signature-256': `sha256=${createHmac('sha256', LOCAL_GITHUB_WEBHOOK_SECRET).update(body).digest('hex')}`
  },
  body
})
console.error(`  github ${event} → ${response.status} ${await response.text()}`)
