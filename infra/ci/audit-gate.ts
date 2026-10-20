/**
 * Fails the build on a `high` or `critical` advisory against anything in `bun.lock`.
 *
 * The whole tree is audited, dev dependencies included. The Lambda layer carries every runtime
 * dependency into every function, so a compromised package there runs with each service's role;
 * and a compromised build tool writes the artifact the layer is made from. Neither half is safe to
 * leave out.
 *
 * `bun audit` asks the registry, so this gate needs the network and is not part of `test:ci` —
 * CI runs it as its own step. The accepted exceptions are `infra/ci/audit-allowlist.json`, and
 * `audit-verdict.ts` says what an entry must carry.
 */
import { allowlistSchema, auditReportSchema, auditVerdict } from './audit-verdict.js'

const ALLOWLIST_PATH = 'infra/ci/audit-allowlist.json'

const audit = Bun.spawnSync(['bun', 'audit', '--json'], { stdout: 'pipe', stderr: 'pipe' })
const output = audit.stdout.toString().trim()
if (!output.startsWith('{')) {
  console.error(`bun audit answered no JSON (exit ${audit.exitCode}); expected a report object:`)
  console.error(audit.stderr.toString() || output)
  process.exit(1)
}

const report = auditReportSchema.parse(JSON.parse(output))
const allowlist = allowlistSchema.parse(await Bun.file(ALLOWLIST_PATH).json())
const verdict = auditVerdict(report, allowlist, new Date().toISOString().slice(0, 10))

for (const finding of verdict.reported) {
  console.error(`reported, not failing: ${finding.severity} ${finding.package} ${finding.advisory}`)
}
for (const finding of verdict.accepted) {
  console.error(`accepted by ${ALLOWLIST_PATH}: ${finding.package} ${finding.advisory}`)
}
if (verdict.failures.length > 0) {
  console.error(`bun audit: ${verdict.failures.length} problem(s)`)
  for (const failure of verdict.failures) {
    console.error(`  ${failure}`)
  }
  process.exit(1)
}
console.error('bun audit: no high or critical advisory outside the allow-list')
