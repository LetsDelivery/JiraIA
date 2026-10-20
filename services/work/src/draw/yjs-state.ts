import { ValidationException } from '@jiraia/core'
import * as Y from 'yjs'

/**
 * A page's content as Yjs keeps it, handled as bytes only (ADR-0009): updates are merged, never
 * applied to a `Y.Doc`, so the server needs neither the editor nor its schema.
 */
const _bytes = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, 'base64'))
const _base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

/**
 * One state from the stored document and the updates since; an empty page is an empty string.
 *
 * @example mergeState('', [])   // ''
 */
export const mergeState = (document: string, updates: readonly string[]): string => {
  const parts = [document, ...updates].filter((each) => each.length > 0)
  if (parts.length === 0) {
    return ''
  }
  return _base64(Y.mergeUpdates(parts.map(_bytes)))
}

/** Refuses what is not a Yjs update, so a bad message never reaches the stored state. */
export const assertUpdate = (update: string, contentId: string): void => {
  try {
    Y.decodeUpdate(_bytes(update))
  } catch {
    throw new ValidationException(`The update for content "${contentId}" is not a Yjs update`, { contentId })
  }
}
