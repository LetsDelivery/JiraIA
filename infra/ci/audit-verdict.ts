/**
 * What `bun audit` found, weighed against the advisories somebody has accepted in writing.
 *
 * The allow-list exists for the advisory nobody can fix yet — a transitive dependency pinned to
 * the vulnerable version by a parent that has not released — and it is shaped so it cannot become
 * a baseline. Every entry names the advisory, the package, **why** it is accepted and **until
 * when**, and the date is at most thirty days out: renewing it is a diff somebody reads, where a
 * list without dates is a list nobody empties. An entry whose advisory stopped appearing is refused
 * too, because a stale exception is the one that silently covers the next advisory on that package.
 *
 * Only `high` and `critical` fail the build. `moderate` and `low` are printed and left to the
 * weekly Dependabot pull request, which is where a bump with no urgency belongs.
 */
import { z } from 'zod'

export const MAX_ALLOWLIST_DAYS = 30

const FAILING_SEVERITIES = new Set(['high', 'critical'])

const advisorySchema = z.object({
  url: z.string(),
  title: z.string(),
  severity: z.string(),
  vulnerable_versions: z.string()
})

/** `bun audit --json`: package name -> the advisories affecting the installed version. */
export const auditReportSchema = z.record(z.string(), z.array(advisorySchema))

export const allowlistSchema = z.object({
  entries: z.array(
    z.object({
      advisory: z.string().regex(/^GHSA-[\w]{4}-[\w]{4}-[\w]{4}$/),
      package: z.string().min(1),
      because: z.string().min(20),
      expires: z.iso.date()
    })
  )
})

export type AuditReport = z.infer<typeof auditReportSchema>
export type Allowlist = z.infer<typeof allowlistSchema>

export type Finding = { package: string; advisory: string; severity: string; title: string }

export type AuditVerdict = { failures: string[]; accepted: Finding[]; reported: Finding[] }

/**
 * Decides whether the audit passes.
 *
 *   const verdict = auditVerdict(report, allowlist, '2026-09-30')
 *   if (verdict.failures.length > 0) process.exit(1)
 */
export function auditVerdict(report: AuditReport, allowlist: Allowlist, today: string): AuditVerdict {
  const findings = _findingsOf(report)
  const failing = findings.filter((finding) => FAILING_SEVERITIES.has(finding.severity))
  const live = allowlist.entries.filter((entry) => entry.expires >= today)
  const isAccepted = (finding: Finding): boolean =>
    live.some((entry) => entry.advisory === finding.advisory && entry.package === finding.package)
  const failures = [
    ...failing.filter((finding) => !isAccepted(finding)).map(_describeFinding),
    ..._allowlistFailures(allowlist, findings, today)
  ]
  const reported = findings.filter((finding) => !FAILING_SEVERITIES.has(finding.severity))
  return { failures, accepted: failing.filter(isAccepted), reported }
}

function _findingsOf(report: AuditReport): Finding[] {
  return Object.entries(report).flatMap(([name, advisories]) =>
    advisories.map((advisory) => ({
      package: name,
      advisory: _advisoryIdOf(advisory.url),
      severity: advisory.severity,
      title: advisory.title
    }))
  )
}

function _advisoryIdOf(url: string): string {
  const id = url.match(/GHSA-[\w]{4}-[\w]{4}-[\w]{4}/)?.[0]
  if (!id) {
    throw new Error(`advisory url ${JSON.stringify(url)} names no GHSA id; expected .../GHSA-xxxx-xxxx-xxxx`)
  }
  return id
}

function _describeFinding(finding: Finding): string {
  return `${finding.severity}: ${finding.package} ${finding.advisory} — ${finding.title}`
}

function _allowlistFailures(allowlist: Allowlist, findings: Finding[], today: string): string[] {
  const latest = _addDays(today, MAX_ALLOWLIST_DAYS)
  return allowlist.entries.flatMap((entry) => {
    const name = `allow-list entry ${entry.package} ${entry.advisory}`
    if (entry.expires < today) {
      return [`${name} expired on ${entry.expires}; fix it or renew it`]
    }
    if (entry.expires > latest) {
      return [`${name} expires ${entry.expires}; at most ${latest} (${MAX_ALLOWLIST_DAYS} days)`]
    }
    const stillReported = findings.some((f) => f.advisory === entry.advisory && f.package === entry.package)
    return stillReported ? [] : [`${name} no longer matches any advisory; delete it`]
  })
}

function _addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
