# 35. The database is woken only by work; idle, it pauses and costs nothing

Date: 2026-10-25

## Status

Accepted. Amends ADR-0002 (a paused cluster answers the Data API with `DatabaseResumingException`),
ADR-0014 (the dispatcher is woken by commits, not every minute), ADR-0024 (the access clock is woken
by its own deadlines, not every five minutes), ADR-0025 (the jobs queue is filled by wakes, not by
schedules; prod's minimum capacity) and ADR-0028 (the `mail` and `morning` jobs run when their work is
due). Task: TEC-3519.

## Context

Aurora Serverless v2 bills per ACU-hour while it runs and nothing while paused, and it pauses only
after five minutes with no statement. Dev had `MinCapacity: 0` and still never paused: CloudWatch
showed 0.51–0.61 ACU all day, nights and weekends included (21–25 Oct 2026), about US$ 48 a month for
nobody. Three jobs read the database every minute (`dispatch`, `mail`, `webhook-retry`) and one every
five (`access-clock`), mostly to find nothing. Prod held 0.5 ACU at all times on purpose, a floor of
about US$ 44 a month, so the first request of the morning would not wait for a resume.

Stênio decided (2026-10-25): the database runs only when there is work, in dev and in prod, with no
calendar of business hours, weekends or holidays; and a person who waits for it to resume is told the
data is on its way.

## Decision

- **Nothing reads the database on a clock**, except Monday's summary, which wakes it once a week for a
  message nearly everyone gets. The per-minute and per-five-minute rules are gone, and so is the daily
  `morning` rule.
- **A commit wakes the dispatch.** Every write records an audit event in its transaction (ADR-0004),
  so the database handle marks a signal when a top-level transaction commits (`wake/commit-signal.ts`);
  the general function ends such an invocation by putting a `dispatch` wake on the FIFO jobs queue. A
  queue batch always wakes it too (a consumer may write outside a transaction, as a webhook's next
  try), and so does a deploy, so the work pending when it landed is planned again.
- **Every pass plans the next wakes** (`wake/planner.ts`). After the jobs a batch asked for have run —
  each once, however many wakes asked — the planner reads, from the work itself, when each job next has
  something to do: the outbox (now), the notices not yet mailed (a mention now, a card's changes at the
  end of their window), the LET’S Draw AI notices and the sprints that end (the next 08:00 in São
  Paulo), the webhook deliveries pending (their next try), and the grants that expire, the approved
  requests that fall due and the reviews that open or close. A job with nothing pending is left out.
  These reads mirror the jobs' own, so a job never looks due to the planner and empty to itself.
- **A wake now goes on the queue; a wake later is a one-time EventBridge Scheduler schedule** in the
  `jiraia-wakes` group, at the minute it falls in, named `<job>-<yyyymmddThhmm>` so two passes planning
  the same work set one schedule, and deleting itself once it has fired. The scheduler's role
  (`WakeRole`) may only put a message on the jobs queue.
- **A job still due after its pass backs off**: a minute, doubled each pass in a row, at most six
  hours. A failing job is not handed back to the queue, so it never keeps the database awake.
- **Both accounts start at zero ACU** and pause after 300 seconds (`SecondsUntilAutoPause`).
- **A paused database is told apart from a broken one.** The Data API client sends a statement again
  while the cluster resumes, for as long as its caller may wait (`resumeAware` in `@jiraia/db`), then
  fails with a 503 `DEPENDENCY_UNAVAILABLE` naming the database. A person's request and a page's socket
  wait nothing; a queue, a job and the deploy wait up to four minutes. The HTTP layer finds the 503
  behind Drizzle's wrapper (`knownCause`).
- **The panel asks again and says so.** Its API client repeats a request every two seconds while the
  answer is that 503, for up to two minutes, with a notice in the corner — "Carregando seus dados…" —
  under the screen's skeleton or the button's spinner, which stay up meanwhile.
- **The panel asks nothing on its own while nobody is at it.** The bell refreshes every minute only
  while the tab is in view and was touched in the last ten minutes, and a page's socket closed by API
  Gateway's idle timeout reconnects at the next touch, not on its own. A tab left open overnight lets
  the database pause.
- **The panel starts the resume before the person clicks.** At their first sign after the tab has been
  four minutes without an answer from the API — the mouse moving, a key, the tab coming back — it sends
  one quiet `GET /work/me`, with no notice and no retries (`api/warm.ts`). The resume then runs while
  they decide where to click, and most of its seconds are never seen.

## Consequences

- Idle costs nothing in Aurora compute: dev drops from about US$ 48 a month to what is used; prod's
  floor of about US$ 44 goes too. Storage and backups are still billed.
- The first request after a pause waits for the resume, typically about 15 seconds and longer after a
  long pause, less what the early ping already took; the panel shows the notice for what is left. A client of the public API (`/v1`, MCP) gets
  the 503 and is expected to retry, as with any 503.
- Events leave for the bus seconds after their commit instead of within a minute; a mention's e-mail
  goes as soon as the pass that follows it.
- A wake lost between a commit and the queue (the send fails after the answer) is logged; that work
  waits for the next commit, deploy or planned wake to be planned again.
- Each one-time schedule and wake message is billed per request: cents a month at JiraIA's volume.
- The local harness follows the same plan in its own process (`LocalWakes`): a write wakes the
  dispatch, and each job runs when its work is due, on a timer.
