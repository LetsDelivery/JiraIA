import { ValidationException } from '@jiraia/core'
import * as Y from 'yjs'

/**
 * A page's content as Yjs keeps it, handled as bytes (ADR-0009): the stored state and the updates since
 * are applied to a bare `Y.Doc` and written back as one state. The doc never names its types, so the
 * server needs neither the editor nor its schema — but it does collect what was deleted, which
 * `Y.mergeUpdates` keeps forever: every step of every drag, until one board passed the Data API's 1 MiB.
 */
const _bytes = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, 'base64'))
const _base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

/**
 * One state from the stored document and the updates since; an empty page is an empty string. An
 * update that arrives before one it builds on waits inside the state, as it did in a merge.
 *
 * @example mergeState('', [])   // ''
 */
export const mergeState = (document: string, updates: readonly string[]): string => {
  const parts = [document, ...updates].filter((each) => each.length > 0)
  if (parts.length === 0) {
    return ''
  }
  const doc = new Y.Doc()
  for (const part of parts) {
    Y.applyUpdate(doc, _bytes(part))
  }
  const state = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return _base64(state)
}

/** Refuses what is not a Yjs update, so a bad message never reaches the stored state. */
export const assertUpdate = (update: string, contentId: string): void => {
  try {
    Y.decodeUpdate(_bytes(update))
  } catch {
    throw new ValidationException(`The update for content "${contentId}" is not a Yjs update`, { contentId })
  }
}
