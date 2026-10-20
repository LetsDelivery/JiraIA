/**
 * The local harness's fixed coordinates. None of them is a default port, so nothing else running on
 * this machine can be mistaken for one of them.
 */
export const LOCAL_PORT = Number(process.env.LOCAL_PORT ?? 8280)
export const DEV_DATABASE = { host: '127.0.0.1', port: 8200, name: 'jiraia' } as const
export const DEV_DATABASE_URL = `postgres://jiraia:jiraia@${DEV_DATABASE.host}:${DEV_DATABASE.port}/${DEV_DATABASE.name}`

/** Where the harness keeps attachments in place of S3, one folder per port (dev and e2e apart). */
export const LOCAL_FILES_DIR = process.env.LOCAL_FILES_DIR ?? `.local-files/${LOCAL_PORT}`
/** Where the harness's e-mails land, one `.html` each (`bus.ts`). */
export const LOCAL_MAIL_DIR = process.env.LOCAL_MAIL_DIR ?? `.local-mail/${LOCAL_PORT}`

/** The end-to-end suite's database (`postgres-e2e`), wiped at the start of every run. */
export const E2E_DATABASE = { host: '127.0.0.1', port: 8220, name: 'jiraia_e2e' } as const
export const E2E_DATABASE_URL = `postgres://jiraia:jiraia@${E2E_DATABASE.host}:${E2E_DATABASE.port}/${E2E_DATABASE.name}`

/** Every service that owns migrations, in the order they apply. */
export const MIGRATION_FOLDERS = ['services/work/drizzle'] as const

/** The service mounted under each first path segment: `/work/spaces` → `work`'s `/spaces`. */
export const SERVICES = ['work'] as const

/** The Google Workspace domain whose people may sign in, as in AWS (ADR-0005). */
export const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? 'uselets.com'

/**
 * The claims Google would put in an ID token for this address, as API Gateway flattens them.
 *
 * Locally there is no Google: `x-local-user: <email>` stands in for a verified sign-in, and `hd` is
 * the address's own domain — so `ana@gmail.com` is refused by the same rule that refuses it in AWS.
 */
export const localClaims = (email: string): Record<string, string> => {
  const address = email.trim().toLowerCase()

  return { sub: `local:${address}`, email: address, email_verified: 'true', hd: address.split('@')[1] ?? '' }
}

/**
 * Refuses anything but the dev container: the harness writes, and the header authorizer below is
 * only safe because nothing it reaches is real.
 */
export const assertDevDatabase = (url: string): void => {
  const parsed = new URL(url)
  const ports: number[] = [DEV_DATABASE.port, E2E_DATABASE.port]
  const local = ['127.0.0.1', 'localhost'].includes(parsed.hostname) && ports.includes(Number(parsed.port))

  if (!local) {
    console.error(`\n  REFUSED: the local harness only runs against the dev or e2e container, not ${parsed.host}.\n`)
    process.exit(1)
  }
}
