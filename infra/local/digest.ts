import { connectDatabase } from '@jiraia/db'

import { buildService } from '../../services/work/src/container.js'
import { LocalMailbox } from './bus.js'
import { ALLOWED_EMAIL_DOMAINS, assertDevDatabase, DEV_DATABASE_URL, LOCAL_MAIL_DIR } from './config.js'

/**
 * Every e-mail that would go out, now, against the dev database (Etapa 5f). In AWS the due ones go
 * every minute, the LET’S Draw AI summary at 08:00 and the weekly one on Monday at 08:00 in São
 * Paulo; here, all of them when you ask, with no window on a card's changes:
 *
 *     bun run local:digest
 *
 * Each message is written to `LOCAL_MAIL_DIR` as an `.html` file.
 */
const url = process.env.DATABASE_URL ?? DEV_DATABASE_URL
assertDevDatabase(url)

const service = buildService(
  {
    DATABASE_URL: url,
    AWS_REGION: 'us-east-1',
    ALLOWED_EMAIL_DOMAINS,
    ATTACHMENTS_BUCKET: 'local',
    REALTIME_URL: 'ws://localhost/realtime'
  },
  { db: connectDatabase({ DATABASE_URL: url }), mailer: new LocalMailbox(LOCAL_MAIL_DIR), mailWindowMs: 0 }
)
for (const [name, run] of [
  ['due', () => service.mail.sendDue()],
  ['morning', () => service.mail.morning()],
  ['weekly', () => service.mail.weekly()]
] as const) {
  const result = await run()
  console.error(`  ${name}: ${result.sent} sent, ${result.failed} not sent`)
}
process.exit(0)
