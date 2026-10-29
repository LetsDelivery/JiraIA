import type { Route } from '@jiraia/http'

import { buildGitHub } from './github/build.js'
import type { GitHubApi } from './github/github-api.js'
import { githubRoutes } from './github/routes.js'
import { buildSlack } from './slack/build.js'
import { slackRoutes } from './slack/routes.js'
import type { SlackApi } from './slack/slack-api.js'

type Deps = Parameters<typeof buildGitHub>[0] & {
  overrides: { slackApi?: SlackApi | undefined; githubApi?: GitHubApi | undefined }
}

/**
 * The organization's connected workspaces — Slack (Etapa 5e, ADR-0018) and GitHub (Etapa 9,
 * ADR-0038) — and their routes. Each is installed once by an organization admin and then tells JiraIA
 * what happens there.
 */
export const buildConnections = ({ overrides, ...deps }: Deps) => {
  const slack = buildSlack({ ...deps, api: overrides.slackApi })
  const github = buildGitHub({ ...deps, api: overrides.githubApi })
  const routes: Route[] = [...slackRoutes(slack.slackConnect), ...githubRoutes(github.githubConnect)]
  return { slack, github, routes }
}
