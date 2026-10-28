import { z } from 'zod'

/**
 * What the importer reads from Atlassian (ADR-0036, Etapa 8a), behind a type this service owns.
 * `HttpAtlassianSource` is the real one; the suite hands in `InMemoryAtlassian`.
 *
 * Only the fields the importer decides on are typed; everything else rides along untouched in
 * `raw`, because the raw copy keeps what Jira said, not what JiraIA understood of it.
 */
export type Raw = Record<string, unknown>

export const jiraProjectSchema = z.looseObject({ id: z.string(), key: z.string(), name: z.string() })
export type JiraProject = z.infer<typeof jiraProjectSchema>

/** One row of a JQL listing: enough to know whether the issue changed since the last run. */
export const issueStubSchema = z.object({
  id: z.string(),
  key: z.string(),
  fields: z.object({ updated: z.string() })
})
export type IssueStub = z.infer<typeof issueStubSchema>

/** An issue as the importer keeps it: Jira's own record plus every page of what hangs off it. */
export type IssueRecord = {
  issue: Raw
  changelog: Raw[]
  comments: Raw[]
  worklogs: Raw[]
}

export type AtlassianSource = {
  /** Every project the account may browse. */
  projects(): Promise<JiraProject[]>
  /** Every field of the site, custom ones included. */
  fields(): Promise<Raw[]>
  /** Jira's own count for a JQL, to reconcile against. */
  count(jql: string): Promise<number>
  /** The issues a JQL finds, page by page. */
  issueStubs(jql: string): AsyncIterable<IssueStub>
  /** One issue with its whole changelog, comments and worklogs. */
  issue(id: string): Promise<IssueRecord>
  /** An attachment's bytes, as uploaded. */
  attachment(id: string): Promise<Uint8Array>
}

/** A fake issue for the suite: Jira's shape, only what the importer reads. */
export const fakeIssue = (
  input: { id: string; key: string; project: string; updated: string } & Partial<IssueRecord>
): IssueRecord => ({
  issue: {
    id: input.id,
    key: input.key,
    fields: { project: { key: input.project }, updated: input.updated },
    ...input.issue
  },
  changelog: input.changelog ?? [],
  comments: input.comments ?? [],
  worklogs: input.worklogs ?? []
})

const projectOf = (jql: string): string | undefined => /project = "([^"]+)"/.exec(jql)?.[1]

/**
 * Jira in memory — the suite's stand-in. `fetched` lists every issue asked for, so a test can tell a
 * copy from a reuse.
 *
 * @example new InMemoryAtlassian({ projects: [{ id: '1', key: 'TEC', name: 'Delivery Board' }], issues: [] })
 */
export class InMemoryAtlassian implements AtlassianSource {
  readonly fetched: string[] = []

  constructor(
    readonly data: { projects: JiraProject[]; issues: IssueRecord[]; fields?: Raw[]; files?: Map<string, Uint8Array> }
  ) {}

  async projects(): Promise<JiraProject[]> {
    return this.data.projects
  }

  async fields(): Promise<Raw[]> {
    return this.data.fields ?? []
  }

  async count(jql: string): Promise<number> {
    return this.inProject(projectOf(jql)).length
  }

  async *issueStubs(jql: string): AsyncIterable<IssueStub> {
    for (const record of this.inProject(projectOf(jql))) {
      yield issueStubSchema.parse(record.issue)
    }
  }

  async issue(id: string): Promise<IssueRecord> {
    this.fetched.push(id)
    const found = this.data.issues.find((record) => record.issue.id === id)
    if (!found) {
      throw new Error(`Issue "${id}" is not in the fake`)
    }
    return found
  }

  async attachment(id: string): Promise<Uint8Array> {
    this.fetched.push(`attachment:${id}`)
    const bytes = this.data.files?.get(id)
    if (!bytes) {
      throw new Error(`Attachment "${id}" is not in the fake`)
    }
    return bytes
  }

  private inProject(key: string | undefined): IssueRecord[] {
    return this.data.issues.filter(
      (record) => (record.issue.fields as { project: { key: string } }).project.key === key
    )
  }
}
