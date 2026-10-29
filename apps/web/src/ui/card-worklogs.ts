import type { Worklog } from '@/api/requests'
import { shortDate, todayInSaoPaulo } from '@/lib/dates'
import { type Html, html } from '@/lib/html'
import { duration } from '@/lib/worklogs'

import { detailPanel } from './detail-panel'

const row = (worklog: Worklog): Html => html`
  <li class="worklog">
    <span class="worklog-head"><strong>${duration(worklog.seconds)}</strong> · ${worklog.author.name} ·
      <span class="muted">${shortDate(todayInSaoPaulo(new Date(worklog.startedAt)))}</span></span>
    ${worklog.comment ? html`<span class="muted">${worklog.comment}</span>` : ''}
  </li>
`

/**
 * Time logged in Jira, kept by the migration (ADR-0036). Read only: JiraIA does not track time, so the
 * panel shows only cards that had it, and offers no way to log more.
 */
export const worklogsSection = (worklogs: readonly Worklog[]): Html => {
  if (worklogs.length === 0) {
    return html``
  }
  const total = worklogs.reduce((sum, worklog) => sum + worklog.seconds, 0)
  return detailPanel({
    title: html`Horas registradas no Jira <span class="count">${duration(total)}</span>`,
    attributes: html`data-worklogs`,
    body: html`<ul class="worklogs">${worklogs.map(row)}</ul>`
  })
}
