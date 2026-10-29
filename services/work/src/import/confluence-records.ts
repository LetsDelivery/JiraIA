import { mentionedIds } from '../cards/mentions.js'
import { adfToMarkdown } from './adf-markdown.js'
import type { PageFile } from './adf-prosemirror.js'
import type { Raw } from './atlassian-source.js'
import type { AttachmentFiles } from './attachment-files.js'
import type { ContentCommentInsert, FileInsert } from './confluence.repository.js'
import { dateOf } from './confluence-content.js'
import type { Ref } from './import.repository.js'
import { inPool } from './jira-raw-copy.js'

/**
 * Etapa 8e (ADR-0036): a Confluence node's files and comments as LET'S Draw keeps them. A file's bytes
 * are in the migration bucket by Confluence's file id (`import/confluence/files/<id>`, from the site
 * backup); each becomes a file of the content that shows it. Comments keep their authors, dates and
 * threads; an inline one still open stays tied to its words.
 */
export const FILES_PREFIX = 'import/confluence/files/'

/** One file a content needs: its own attachment, or one its body shows from elsewhere. */
export type FilePlan = PageFile & {
  /** Confluence's file id: the media id a body names, and the backup object's name. */
  mediaId: string
  sourceId: string
  contentType: string
  uploadedBy: string
  createdAt: Date
  /** Not imported by an earlier run. */
  fresh: boolean
}

export type Who = (accountId: unknown) => string

/** A file wanted by a content before its id is known: from an attachment, or a media node. */
type Wanted = Omit<FilePlan, 'fileId' | 'sourceId' | 'fresh'>

const isImage = (contentType: string): boolean => contentType.startsWith('image/')

export const fromAttachment = (attachment: Raw, who: Who, fallback: Date): Wanted => {
  const contentType = String(attachment.mediaType ?? '') || 'application/octet-stream'
  const version = (attachment.version ?? {}) as Raw
  return {
    mediaId: String(attachment.fileId),
    name: String(attachment.title ?? attachment.fileId),
    size: Number(attachment.fileSize) || 0,
    image: isImage(contentType),
    contentType,
    uploadedBy: who(version.authorId),
    createdAt: dateOf(attachment.createdAt ?? version.createdAt, fallback)
  }
}

/** A media node no attachment of the page describes: named by its alt text, typed as an image or a file. */
export const fromMedia = (mediaId: string, attrs: Raw, uploadedBy: string, at: Date): Wanted => {
  const name = String(attrs.alt ?? '') || mediaId
  const image = attrs.type !== 'file' || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)
  return {
    mediaId,
    name,
    size: 0,
    image,
    contentType: image ? 'image/png' : 'application/octet-stream',
    uploadedBy,
    createdAt: at
  }
}

/** The files a content will show, each with its Draw id — the one an earlier run gave it, or a new one. */
export const planFiles = (
  contentSource: string,
  wanted: Wanted[],
  refs: Map<string, Ref>,
  newId: () => string
): FilePlan[] => {
  const unique = [...new Map(wanted.map((file) => [file.mediaId, file])).values()]
  return unique.map((file) => {
    const sourceId = `${contentSource}:${file.mediaId}`
    const ref = refs.get(sourceId)
    return { ...file, sourceId, fileId: ref?.targetId ?? newId(), fresh: !ref }
  })
}

/** Copies the new files' bytes to the content's keys; answers the media ids the backup has no bytes for. */
export const copyFiles = async (
  files: AttachmentFiles,
  plans: { contentId: string; file: FilePlan }[],
  keyOf: (contentId: string, fileId: string) => string
): Promise<Set<string>> => {
  const missing = new Set<string>()
  await inPool(plans, 8, async ({ contentId, file }) => {
    try {
      await files.copy({
        from: `${FILES_PREFIX}${file.mediaId}`,
        to: keyOf(contentId, file.fileId),
        contentType: file.contentType
      })
    } catch (error) {
      if (!isMissing(error)) {
        throw error
      }
      missing.add(file.mediaId)
    }
  })
  return missing
}

const isMissing = (error: unknown): boolean => {
  const name = (error as { name?: string }).name
  return name === 'NoSuchKey' || name === 'NotFound'
}

export const fileRow = (contentId: string, file: FilePlan, objectKey: string): FileInsert => ({
  id: file.fileId,
  contentId,
  name: file.name.slice(0, 255),
  contentType: file.contentType,
  size: file.size,
  objectKey,
  status: 'ready',
  uploadedBy: file.uploadedBy,
  createdAt: file.createdAt
})

type CommentInput = {
  contentId: string
  who: Who
  mention: (accountId: string) => string | undefined
  ids: (sourceId: string) => string
  at: Date
}

/** A comment's words as the panel shows them: Markdown, with `<@member>` for each mention. */
const bodyOf = (comment: Raw, mention: CommentInput['mention']): string => {
  const value = ((comment.body ?? {}) as { atlas_doc_format?: { value?: unknown } }).atlas_doc_format?.value
  const document = typeof value === 'string' && value ? JSON.parse(value) : null
  return adfToMarkdown(document, { mention })
}

/** Every reply under a comment, however deep Confluence nested them: Draw's threads are one level. */
const repliesOf = (comment: Raw): Raw[] =>
  ((comment.replies as Raw[] | undefined) ?? []).flatMap((reply) => [reply, ...repliesOf(reply)])

const commentRow = (comment: Raw, input: CommentInput, thread: Partial<ContentCommentInsert>): ContentCommentInsert => {
  const version = (comment.version ?? {}) as Raw
  const body = bodyOf(comment, input.mention)
  return {
    id: input.ids(String(comment.id)),
    contentId: input.contentId,
    parentId: null,
    anchorId: null,
    quote: null,
    authorId: input.who(version.authorId),
    body,
    mentions: mentionedIds(body),
    createdAt: dateOf(version.createdAt, input.at),
    editedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    ...thread
  }
}

/** Where an inline comment sits: the marker the page puts on its words, and those words. */
const anchorOf = (comment: Raw): Partial<ContentCommentInsert> => {
  const properties = (comment.properties ?? {}) as Raw
  return {
    anchorId: String(properties.inlineMarkerRef ?? '') || null,
    quote: String(properties.inlineOriginalSelection ?? '') || null
  }
}

/** A resolved thread was resolved when its last comment was written: Confluence keeps no other date. */
const lastDate = (rows: ContentCommentInsert[], fallback: Date): Date =>
  rows.map((row) => row.createdAt as Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? fallback

/** A thread: its first comment — tied to its words when inline — then its replies, in order. */
export const threadRows = (comment: Raw, input: CommentInput, inline: boolean): ContentCommentInsert[] => {
  const replies = repliesOf(comment).map((reply) => commentRow(reply, input, {}))
  const first = commentRow(comment, input, inline ? anchorOf(comment) : {})
  const root =
    comment.resolutionStatus === 'resolved' ? { ...first, resolvedAt: lastDate([first, ...replies], input.at) } : first
  return [root, ...replies.map((reply) => ({ ...reply, parentId: root.id }))]
}

/** The marker of every inline comment still open: the words the page keeps marked. */
export const openAnchors = (inlineComments: Raw[]): Set<string> =>
  new Set(
    inlineComments
      .filter((comment) => comment.resolutionStatus !== 'resolved')
      .map((comment) => String(((comment.properties ?? {}) as Raw).inlineMarkerRef ?? ''))
      .filter(Boolean)
  )
