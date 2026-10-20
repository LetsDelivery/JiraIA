import type { Block, Installed, SlackApi } from '../../services/work/src/slack/slack-api.js'

/**
 * Slack, locally (Etapa 5e): until the Slack app exists (pendência #10), connecting a workspace in
 * `bun run up` "installs" into LET’S (local), finds each person by e-mail, and prints the messages and
 * previews instead of sending them. Nothing leaves the machine.
 */
export class LocalSlackApi implements SlackApi {
  async exchange(): Promise<Installed> {
    return { teamId: 'T-LOCAL', teamName: 'LET’S (local)', botUserId: 'U-JIRAIA', token: 'xoxb-local' }
  }

  async userByEmail(_token: string, email: string): Promise<string | null> {
    return `U-${email.split('@')[0]?.toUpperCase() ?? 'X'}`
  }

  async post(_token: string, message: { channel: string; text: string; blocks?: Block[] }): Promise<void> {
    console.error(`  slack → ${message.channel}: ${message.text}`)
  }

  async unfurl(
    _token: string,
    channel: string,
    _ts: string,
    unfurls: Record<string, { blocks: Block[] }>
  ): Promise<void> {
    console.error(`  slack preview → ${channel}: ${Object.keys(unfurls).join(', ')}`)
  }
}

/**
 * The local Slack app's settings: a real app's, from the environment, when they are there; otherwise a
 * stand-in id and a fixed key, enough to try the whole flow on this machine.
 */
export const localSlackConfig = (env: NodeJS.ProcessEnv) =>
  env.SLACK_CLIENT_ID
    ? {
        SLACK_CLIENT_ID: env.SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET: env.SLACK_CLIENT_SECRET ?? '',
        SLACK_SIGNING_SECRET: env.SLACK_SIGNING_SECRET ?? '',
        SLACK_TOKEN_KEY: env.SLACK_TOKEN_KEY ?? ''
      }
    : {
        SLACK_CLIENT_ID: 'local',
        SLACK_CLIENT_SECRET: 'local',
        SLACK_SIGNING_SECRET: 'local-signing-secret',
        SLACK_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64')
      }
