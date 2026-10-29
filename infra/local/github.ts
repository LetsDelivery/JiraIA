import type { GitHubApi, Installation } from '../../services/work/src/github/github-api.js'

/**
 * GitHub, locally (Etapa 9): until the GitHub App exists, completing an installation in `bun run up`
 * "installs" on LetsDelivery (local), and `bun run local:github` plays GitHub's deliveries, signed with
 * the local secret. Nothing leaves the machine.
 */
export class LocalGitHubApi implements GitHubApi {
  async installation(installationId: string): Promise<Installation> {
    return { id: installationId, account: 'LetsDelivery (local)' }
  }

  async installations(): Promise<Installation[]> {
    return [{ id: '1', account: 'LetsDelivery (local)' }]
  }
}

export const LOCAL_GITHUB_WEBHOOK_SECRET = 'local-github-webhook-secret'

/**
 * The local GitHub App's settings: a real App's, from the environment, when they are there; otherwise a
 * stand-in id, a placeholder key the stand-in never uses, and a fixed webhook secret.
 */
export const localGitHubConfig = (env: NodeJS.ProcessEnv) =>
  env.GITHUB_APP_ID
    ? {
        GITHUB_APP_ID: env.GITHUB_APP_ID,
        GITHUB_APP_SLUG: env.GITHUB_APP_SLUG ?? '',
        GITHUB_PRIVATE_KEY: env.GITHUB_PRIVATE_KEY ?? '',
        GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET ?? ''
      }
    : {
        GITHUB_APP_ID: '1',
        GITHUB_APP_SLUG: 'jiraia-local',
        GITHUB_PRIVATE_KEY: 'local-placeholder-'.repeat(8),
        GITHUB_WEBHOOK_SECRET: LOCAL_GITHUB_WEBHOOK_SECRET
      }
