/**
 * The first thing that runs in any test process (bunfig.toml `preload`).
 *
 * Unconditional overrides: whatever the shell, `.env` or CI had to say about the database or a
 * credential is discarded, not merged — modules read configuration at import time, so by the time a
 * `beforeAll` ran a client would already be pointed somewhere.
 */
import { TEST_DATABASE_URL } from './config.js'
import { abort, databaseRefusal } from './guard.js'
import { refuseRemoteFetch } from './offline.js'

process.env.NODE_ENV = 'test'
process.env.TZ = 'UTC'
process.env.DATABASE_URL = TEST_DATABASE_URL

// No AWS call may authenticate from a test, whatever the endpoint says.
process.env.AWS_REGION = 'us-east-1'
process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE'
process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
delete process.env.AWS_SESSION_TOKEN
delete process.env.AWS_PROFILE

process.env.POWERTOOLS_LOG_LEVEL = 'SILENT'
process.env.POWERTOOLS_METRICS_DISABLED = 'true'

// The router checks every handler answered what its route declares: the integration suite doubles
// as a verification of the generated API contract.
process.env.VALIDATE_RESPONSES = '1'

const refusal = databaseRefusal(process.env.DATABASE_URL)
if (refusal) {
  abort(refusal)
}

refuseRemoteFetch()
