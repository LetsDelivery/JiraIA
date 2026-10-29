import { z } from 'zod'

import { keysInText } from '../slack/card-keys.js'

/**
 * The parts of GitHub's webhook payloads JiraIA reads (ADR-0038). Anything else GitHub sends is ignored,
 * so a field GitHub adds or drops elsewhere changes nothing here.
 */
const repository = z.object({ full_name: z.string(), html_url: z.string(), default_branch: z.string() })
const installation = z.object({ id: z.number() })
const login = z.object({ login: z.string() })

export const installationEventSchema = z.object({ action: z.string(), installation })

/** `create` and `delete`: a branch or a tag; only branches are read. */
export const refEventSchema = z.object({
  ref: z.string(),
  ref_type: z.string(),
  repository,
  installation,
  sender: login
})
export type RefEvent = z.infer<typeof refEventSchema>

const pullRequest = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  merged: z.boolean().nullable().optional(),
  merged_at: z.string().nullable().optional(),
  user: login,
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string() })
})
export type PullRequest = z.infer<typeof pullRequest>

export const pullRequestEventSchema = z.object({
  action: z.string(),
  pull_request: pullRequest,
  repository,
  installation
})
export type PullRequestEvent = z.infer<typeof pullRequestEventSchema>

export const reviewEventSchema = z.object({
  action: z.string(),
  review: z.object({ state: z.string() }),
  pull_request: z.object({ number: z.number() }),
  repository,
  installation
})
export type ReviewEvent = z.infer<typeof reviewEventSchema>

export const checkSuiteEventSchema = z.object({
  action: z.string(),
  check_suite: z.object({ head_sha: z.string(), conclusion: z.string().nullable().optional() }),
  repository,
  installation
})
export type CheckSuiteEvent = z.infer<typeof checkSuiteEventSchema>

/** At most this many cards for one branch or pull request: a key list in a title is not a plan. */
const KEYS_PER_REF = 5

/**
 * The card keys a branch or a pull request names: in the branch's name and in the title.
 *
 * @example keysOf('feat/req-12-frete', 'REQ-12 e TEC-3: frete')   // ['REQ-12', 'TEC-3']
 */
export const keysOf = (...texts: string[]): string[] => keysInText(texts.join(' '), KEYS_PER_REF)

export type PullState = 'open' | 'draft' | 'closed' | 'merged'

/** @example pullState({ state: 'closed', merged: true, … })   // 'merged' */
export const pullState = (pull: Pick<PullRequest, 'state' | 'draft' | 'merged' | 'merged_at'>): PullState => {
  if (pull.merged || pull.merged_at) {
    return 'merged'
  }
  if (pull.state === 'closed') {
    return 'closed'
  }
  return pull.draft ? 'draft' : 'open'
}

/** What a review says of the pull request; a plain comment says nothing, so it leaves the last word. */
export const reviewOf = (event: ReviewEvent): 'approved' | 'changes_requested' | null | undefined => {
  if (event.action === 'dismissed') {
    return null
  }
  const state = event.review.state.toLowerCase()
  return state === 'approved' || state === 'changes_requested' ? state : undefined
}

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'])

/**
 * The checks of a commit after a suite's event. Several suites run on one commit; a failure stays until
 * the checks are asked for again, so one suite passing does not hide another failing.
 *
 * @example checksAfter('completed', 'success', 'failure')   // 'failure'
 */
export const checksAfter = (
  action: string,
  conclusion: string | null | undefined,
  current: string | null
): 'pending' | 'success' | 'failure' | undefined => {
  if (action === 'requested' || action === 'rerequested') {
    return 'pending'
  }
  if (action !== 'completed') {
    return undefined
  }
  if (conclusion && FAILED.has(conclusion)) {
    return 'failure'
  }
  return current === 'failure' ? 'failure' : 'success'
}
