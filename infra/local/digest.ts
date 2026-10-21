import { connectDatabase } from '@jiraia/db'

import { buildService } from '../../services/work/src/container.js'
import { LocalMailbox } from './bus.js'
import { ALLOWED_EMAIL_DOMAINS, assertDevDatabase, DEV_DATABASE_URL, LOCAL_MAIL_DIR } from './config.js'

/**
 * The daily summary, now, against the dev database (escopo-mvp 4.6). In AWS it runs at 08:00 in São
 * Paulo; here, when you ask:
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
  { db: connectDatabase({ DATABASE_URL: url }), mailer: new LocalMailbox(LOCAL_MAIL_DIR) }
)
const result = await service.digest.run()
console.error(`  digest: ${result.sent} sent, ${result.failed} not sent`)
process.exit(0)
