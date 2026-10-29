import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import { adfToProseMirror, type PageFile, type ProseMirrorOptions, textOf } from './adf-prosemirror.js'
import type { Raw } from './atlassian-source.js'
import type { AttachmentFiles } from './attachment-files.js'
import type {
  ConfluenceRepository,
  ContentCommentInsert,
  ContentInsert,
  VersionInsert
} from './confluence.repository.js'
import {
  bodyOf,
  databaseDoc,
  dateOf,
  embedDoc,
  emojiOf,
  kindOf,
  mediaNodes,
  pageDoc,
  placeTree
} from './confluence-content.js'
import { auditEvent, type ImportContext, type LoadedSpace, type NodeFile, refRow, whoOf } from './confluence-context.js'
import { versionKey } from './confluence-raw-copy.js'
import {
  copyFiles,
  type FilePlan,
  fileRow,
  fromAttachment,
  fromMedia,
  openAnchors,
  planFiles,
  threadRows
} from './confluence-records.js'
import { type BoardDocument, boardImageIds, boardText, whiteboardToDraw } from './confluence-whiteboard.js'
import type { ImportRepository, Ref, RefRow } from './import.repository.js'
import type { ImportStore } from './import-store.js'
import { chunk, hashOf } from './jira-mapping.js'
import { inPool } from './jira-raw-copy.js'

export type ContentTally = {
  contents: { inserted: number; updated: number; unchanged: number }
  files: number
  versions: number
  comments: number
  /** Files a page or board shows that the backup holds no bytes for: shown by name. */
  missingFiles: string[]
  /** Whiteboards and databases the backup has no data for: imported empty. */
  withoutBackup: string[]
  /** Comments pinned on whiteboards: the backup keeps the pin, not the words. */
  boardComments: number
}

type Deps = {
  db: Database
  store: ImportStore
  files: AttachmentFiles
  clock: Clock
  ids: IdGenerator
  repository: ConfluenceRepository
  refs: ImportRepository
}

/** A version not imported yet: what Confluence says of it, and its body when it is a page's. */
type NewVersion = { number: number; meta: Raw; body: Raw | undefined }

/** One node on its way to Draw. The archive folder is a node of the import's own (`archive:<space>`). */
type Plan = {
  source: string
  id: string
  type: string
  file: NodeFile | undefined
  parentId: string | null
  position: number
  ref: Ref | undefined
  files: FilePlan[]
  versions: NewVersion[]
}

type Derived = { json: Record<string, unknown>; text: string }

const ARCHIVE = 'Arquivados'
const EMPTY_BOARD: BoardDocument = { nodes: {}, edges: {} }

/**
 * Etapa 8e (ADR-0036): one Confluence space's tree written into its Draw space — contents in
 * Confluence's order, their files, versions and comments, each remembered in `import_refs`.
 */
export class ConfluenceContents {
  constructor(private readonly deps: Deps) {}

  async import(context: ImportContext, loaded: LoadedSpace, spaceId: string): Promise<ContentTally> {
    const plans = this.plan(context, loaded)
    await this.loadVersions(context, plans)
    for (const plan of plans) {
      plan.files = planFiles(plan.source, this.wantedFiles(context, plan), context.refs.file, () =>
        this.deps.ids.next()
      )
    }
    const fresh = plans.flatMap((plan) => plan.files.filter((file) => file.fresh).map((file) => ({ plan, file })))
    const missing = await copyFiles(
      this.deps.files,
      fresh.map(({ plan, file }) => ({ contentId: plan.id, file })),
      (contentId, fileId) => objectKey(context, contentId, fileId)
    )
    const tally = await this.writeContents(context, spaceId, plans, missing)
    tally.files = await this.writeFiles(context, fresh, missing)
    tally.versions = await this.writeVersions(context, spaceId, plans, missing)
    tally.comments = await this.writeComments(context, spaceId, plans)
    return tally
  }

  /** Every node with its Draw id and place; archived pages under a folder of their own. */
  private plan(context: ImportContext, loaded: LoadedSpace): Plan[] {
    const archiveSource = `archive:${String(loaded.space.id)}`
    const archiveId = context.refs.content.get(archiveSource)?.targetId ?? this.deps.ids.next()
    const nodes = new Map([...loaded.nodes].map(([id, file]) => [id, file.node]))
    const placed = placeTree(loaded.rows, nodes, archiveId)
    const idOf = new Map(
      loaded.rows.map((row) => [row.id, context.refs.content.get(row.id)?.targetId ?? this.deps.ids.next()])
    )
    const plans = loaded.rows.map((row): Plan => {
      const place = placed.get(row.id) ?? { parentId: null, position: 1 }
      const parentId = place.parentId === archiveId ? archiveId : (idOf.get(place.parentId ?? '') ?? null)
      const ref = context.refs.content.get(row.id)
      const id = idOf.get(row.id) as string
      const base = { source: row.id, id, type: row.type, file: loaded.nodes.get(row.id), ref }
      return { ...base, parentId, position: place.position, files: [], versions: [] }
    })
    if (![...placed.values()].some((place) => place.parentId === archiveId)) {
      return plans
    }
    const roots = plans.filter((plan) => plan.parentId === null).length
    const archive: Plan = {
      ...{ source: archiveSource, id: archiveId, type: 'folder', file: undefined, parentId: null },
      ...{ position: roots + 1, ref: context.refs.content.get(archiveSource), files: [], versions: [] }
    }
    return [archive, ...plans]
  }

  /** The versions no earlier run imported; a page's with the body Confluence had then. */
  private async loadVersions(context: ImportContext, plans: Plan[]): Promise<void> {
    await inPool(plans, 8, async (plan) => {
      for (const meta of versionsToImport(context, plan)) {
        const number = Number(meta.number)
        const body = plan.type === 'page' ? await this.deps.store.getJson(versionKey(plan.source, number)) : undefined
        plan.versions.push({ number, meta, body: body as Raw | undefined })
      }
      plan.versions.sort((a, b) => a.number - b.number)
    })
  }

  /** The files a node shows: a page's attachments and media, a board's images. */
  private wantedFiles(context: ImportContext, plan: Plan) {
    const node = plan.file?.node
    if (!node) {
      return []
    }
    const who = whoOf(context)
    const at = dateOf(node.createdAt, context.at)
    if (plan.type === 'whiteboard') {
      const board = context.backup.get(plan.source)?.doc as BoardDocument | undefined
      return boardImageIds(board ?? EMPTY_BOARD).map((id) =>
        fromMedia(id, { alt: `imagem-${id.slice(0, 8)}`, type: 'image' }, who(node.authorId), at)
      )
    }
    const own = (plan.file?.attachments ?? []).map((attachment) => fromAttachment(attachment, who, at))
    const media = mediaNodes(bodyOf(node))
    for (const version of plan.versions) {
      mediaNodes(version.body ? bodyOf(version.body) : null, media)
    }
    const shown = [...media].map(([id, attrs]) => {
      const attachment = context.attachments.get(id)
      return attachment ? fromAttachment(attachment, who, at) : fromMedia(id, attrs, who(node.authorId), at)
    })
    return [...own, ...shown]
  }

  private optionsOf(context: ImportContext, plan: Plan, missing: Set<string>, anchors: Set<string>) {
    const files = new Map(plan.files.filter((file) => !missing.has(file.mediaId)).map((file) => [file.mediaId, file]))
    const options: ProseMirrorOptions = {
      mention: (accountId) => {
        const id = context.people.memberOf(accountId)
        return id ? { id, label: context.names.get(id) ?? '' } : undefined
      },
      file: (mediaId) => files.get(mediaId) as PageFile | undefined,
      anchor: (annotationId) => (anchors.has(annotationId) ? annotationId : undefined)
    }
    return { options, files }
  }

  /** What the content opens as now: a page's body, a board's drawing, a database's table. */
  private derive(context: ImportContext, plan: Plan, missing: Set<string>): Derived {
    const node = plan.file?.node
    if (!node || plan.type === 'folder') {
      return { json: {}, text: '' }
    }
    if (plan.type === 'whiteboard') {
      return this.board(context, plan, missing)
    }
    const doc =
      plan.type === 'database'
        ? databaseDoc(context.backup.get(plan.source)?.doc)
        : plan.type === 'embed'
          ? embedDoc(node)
          : this.page(context, plan, missing)
    return { json: doc, text: textOf(doc) }
  }

  private board(context: ImportContext, plan: Plan, missing: Set<string>): Derived {
    const { files } = this.optionsOf(context, plan, missing, new Set())
    const board = whiteboardToDraw(
      (context.backup.get(plan.source)?.doc as BoardDocument | undefined) ?? EMPTY_BOARD,
      (mediaId) => files.get(mediaId)?.fileId
    )
    return { json: board, text: boardText(board) }
  }

  /** A page's body, its open inline comments marked, its unshown attachments listed at the end. */
  private page(context: ImportContext, plan: Plan, missing: Set<string>) {
    const anchors = openAnchors(plan.file?.inlineComments ?? [])
    const { options, files } = this.optionsOf(context, plan, missing, anchors)
    const own = new Set((plan.file?.attachments ?? []).map((attachment) => String(attachment.fileId)))
    const attachments = [...files.values()].filter((file) => own.has(file.mediaId))
    return pageDoc(bodyOf(plan.file?.node ?? {}), options, attachments)
  }

  private contentRow(context: ImportContext, spaceId: string, plan: Plan, derived: Derived): ContentInsert {
    const node = plan.file?.node ?? {}
    const createdAt = dateOf(node.createdAt, context.at)
    const version = (node.version ?? {}) as Raw
    return {
      id: plan.id,
      organizationId: context.organizationId,
      spaceId,
      parentId: plan.parentId,
      kind: kindOf(plan.type),
      title: (plan.file ? String(node.title ?? '') : ARCHIVE).slice(0, 255) || 'Sem título',
      icon: emojiOf(node),
      position: plan.position,
      contentJson: derived.json,
      contentText: derived.text,
      // The archive folder is the import's own; whoOf answers the importer for an account it lacks.
      createdBy: whoOf(context)(node.authorId),
      updatedBy: whoOf(context)(version.authorId ?? node.authorId),
      createdAt,
      updatedAt: dateOf(version.createdAt, createdAt)
    }
  }

  /** New and changed contents, parents first, each batch with its references and creation events. */
  private async writeContents(context: ImportContext, spaceId: string, plans: Plan[], missing: Set<string>) {
    const tally: ContentTally = {
      contents: { inserted: 0, updated: 0, unchanged: 0 },
      ...{ files: 0, versions: 0, comments: 0, boardComments: 0 },
      missingFiles: plans.flatMap((plan) =>
        plan.files.filter((file) => missing.has(file.mediaId)).map((file) => `${plan.source}:${file.name}`)
      ),
      withoutBackup: plans
        .filter((plan) => (plan.type === 'whiteboard' || plan.type === 'database') && !context.backup.has(plan.source))
        .map((plan) => String(plan.file?.node.title ?? plan.source))
    }
    const changed = plans.flatMap((plan) => {
      const hash = hashOf({
        file: plan.file,
        backup: context.backup.get(plan.source),
        plan: [plan.parentId, plan.position],
        // A file the backup lacked shows by name; once it arrives, the content shows it.
        missing: plan.files.filter((file) => missing.has(file.mediaId)).map((file) => file.mediaId)
      })
      tally.boardComments += boardComments(context, plan)
      if (plan.ref?.contentHash === hash) {
        tally.contents.unchanged += 1
        return []
      }
      tally.contents[plan.ref ? 'updated' : 'inserted'] += 1
      return [{ plan, hash, row: this.contentRow(context, spaceId, plan, this.derive(context, plan, missing)) }]
    })
    for (const batch of chunk(changed, 10)) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.repository.upsertContents(
          tx,
          batch.map((each) => each.row)
        )
        await this.deps.repository.audit(
          tx,
          batch.filter((each) => !each.plan.ref).map((each) => this.created(context, spaceId, each.row))
        )
        await this.deps.refs.putRefs(
          tx,
          batch.map((each) => refRow(context, 'content', each.plan.source, each.plan.id, each.hash))
        )
      })
    }
    return tally
  }

  private created(context: ImportContext, spaceId: string, row: ContentInsert) {
    return auditEvent(context, this.deps.ids.next(), {
      spaceId,
      entityType: 'content',
      entityId: row.id,
      action: 'created',
      actorId: row.createdBy,
      at: row.createdAt as Date,
      changes: {
        kind: { before: null, after: row.kind },
        title: { before: null, after: row.title },
        parentId: { before: null, after: row.parentId ?? null }
      }
    })
  }

  private async writeFiles(context: ImportContext, fresh: { plan: Plan; file: FilePlan }[], missing: Set<string>) {
    const found = fresh.filter(({ file }) => !missing.has(file.mediaId))
    for (const batch of chunk(found, 50)) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.repository.insertFiles(
          tx,
          batch.map(({ plan, file }) => fileRow(plan.id, file, objectKey(context, plan.id, file.fileId)))
        )
        await this.deps.refs.putRefs(
          tx,
          batch.map(({ file }) => refRow(context, 'file', file.sourceId, file.fileId))
        )
      })
    }
    return found.length
  }

  /** Every version Confluence kept, numbered as there; a board, database or embed has its last one. */
  private async writeVersions(context: ImportContext, spaceId: string, plans: Plan[], missing: Set<string>) {
    const rows = plans.flatMap((plan) => this.versionRows(context, plan, missing))
    for (const batch of chunk(rows, 10)) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.repository.insertVersions(
          tx,
          batch.map((each) => each.row)
        )
        await this.deps.repository.audit(
          tx,
          batch.map((each) => this.versionSaved(context, spaceId, each.row))
        )
        await this.deps.refs.putRefs(
          tx,
          batch.map((each) => each.ref)
        )
      })
    }
    return rows.length
  }

  private versionRows(context: ImportContext, plan: Plan, missing: Set<string>) {
    const { options } = this.optionsOf(context, plan, missing, new Set())
    const current = plan.type === 'page' ? undefined : this.derive(context, plan, missing)
    return plan.versions.flatMap((version) => {
      const derived = current ?? (version.body ? pageVersion(version.body, options) : undefined)
      if (!derived) {
        return []
      }
      const row = this.versionRow(context, plan, version, derived)
      return [{ row, ref: refRow(context, 'version', `${plan.source}:${version.number}`, row.id) }]
    })
  }

  private versionRow(context: ImportContext, plan: Plan, version: NewVersion, derived: Derived): VersionInsert {
    const message = String(version.meta.message ?? '').trim()
    const title = String(version.body?.title ?? plan.file?.node.title ?? '')
    return {
      id: this.deps.ids.next(),
      contentId: plan.id,
      number: version.number,
      title: title.slice(0, 255) || 'Sem título',
      contentJson: derived.json,
      contentText: derived.text,
      document: '',
      // A message someone wrote when publishing names the version, as one saved by hand.
      reason: message ? 'manual' : 'auto',
      name: message ? message.slice(0, 120) : null,
      restoredFrom: null,
      createdBy: whoOf(context)(version.meta.authorId),
      createdAt: dateOf(version.meta.createdAt, context.at)
    }
  }

  private versionSaved(context: ImportContext, spaceId: string, row: VersionInsert) {
    return auditEvent(context, this.deps.ids.next(), {
      spaceId,
      entityType: 'content',
      entityId: row.contentId,
      action: 'version_saved',
      actorId: row.createdBy,
      at: row.createdAt as Date,
      changes: { version: { before: row.number > 1 ? row.number - 1 : null, after: row.number } }
    })
  }

  /** Each page's footer and inline threads, each comment once, by its Confluence id. */
  private async writeComments(context: ImportContext, spaceId: string, plans: Plan[]) {
    const rows: { row: ContentCommentInsert; ref: RefRow }[] = []
    for (const plan of plans.filter((each) => each.type === 'page' && each.file)) {
      rows.push(...this.commentRows(context, plan))
    }
    for (const batch of chunk(rows, 25)) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.repository.insertComments(
          tx,
          batch.map((each) => each.row)
        )
        await this.deps.repository.audit(
          tx,
          batch.map((each) => this.commented(context, spaceId, each.row))
        )
        await this.deps.refs.putRefs(
          tx,
          batch.map((each) => each.ref)
        )
      })
    }
    return rows.length
  }

  private commentRows(context: ImportContext, plan: Plan) {
    const assigned = new Map<string, string>()
    const ids = (sourceId: string) => {
      const known = context.refs.comment.get(sourceId)?.targetId ?? assigned.get(sourceId) ?? this.deps.ids.next()
      assigned.set(sourceId, known)
      return known
    }
    const input = {
      contentId: plan.id,
      who: whoOf(context),
      mention: (accountId: string) => {
        const member = context.people.memberOf(accountId)
        return member ? `<@${member}>` : undefined
      },
      ids,
      at: context.at
    }
    const threads = [
      ...(plan.file?.footerComments ?? []).flatMap((comment) => threadRows(comment, input, false)),
      ...(plan.file?.inlineComments ?? []).flatMap((comment) => threadRows(comment, input, true))
    ]
    const sourceOf = new Map([...assigned].map(([source, id]) => [id, source]))
    return threads
      .map((row) => ({ row, source: sourceOf.get(row.id) ?? row.id }))
      .filter(({ source }) => !context.refs.comment.has(source))
      .map(({ row, source }) => ({ row, ref: refRow(context, 'comment', source, row.id) }))
  }

  private commented(context: ImportContext, spaceId: string, row: ContentCommentInsert) {
    return auditEvent(context, this.deps.ids.next(), {
      spaceId,
      entityType: 'content_comment',
      entityId: row.id,
      action: 'commented',
      actorId: row.authorId,
      at: row.createdAt as Date,
      changes: { body: { before: null, after: row.body } }
    })
  }
}

/** Where a content's file lives in the attachments bucket, as an upload from the panel puts it. */
const objectKey = (context: ImportContext, contentId: string, fileId: string): string =>
  `${context.organizationId}/contents/${contentId}/${fileId}`

const boardComments = (context: ImportContext, plan: Plan): number =>
  plan.type === 'whiteboard'
    ? Object.values((context.backup.get(plan.source)?.doc as BoardDocument | undefined)?.nodes ?? {}).filter(
        (node) => node.type === 'comment'
      ).length
    : 0

/** A page as one version had it: its body then, without the attachments listed at the end now. */
const pageVersion = (body: Raw, options: ProseMirrorOptions): Derived => {
  const doc = adfToProseMirror(bodyOf(body), options)
  return { json: doc, text: textOf(doc) }
}

/** A page's versions, or a board's, database's or embed's last one, that no earlier run imported. */
const versionsToImport = (context: ImportContext, plan: Plan): Raw[] => {
  const node = plan.file?.node
  if (!node || plan.type === 'folder') {
    return []
  }
  const listed = plan.type === 'page' ? (plan.file?.versions ?? []) : [(node.version ?? {}) as Raw]
  return listed.filter(
    (meta) => Number(meta.number) > 0 && !context.refs.version.has(`${plan.source}:${Number(meta.number)}`)
  )
}
