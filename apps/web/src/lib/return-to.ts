/**
 * Where to go after signing in: the page a signed-out person opened — a consent page an application
 * sent them to (ADR-0021), a card someone linked. Kept for this tab only.
 */
const KEY = 'jiraia.return-to'

export const rememberReturn = (storage: Pick<Storage, 'setItem'>, path: string): void => {
  try {
    if (path !== '/' && path.startsWith('/') && !path.startsWith('//')) {
      storage.setItem(KEY, path)
    }
  } catch {
    // A storage that refuses only loses the way back; signing in still works.
  }
}

/**
 * The page to return to, once: it is forgotten as it is read.
 *
 * @example takeReturn(sessionStorage)   // '/oauth/autorizar?client_id=…' or '/'
 */
export const takeReturn = (storage: Pick<Storage, 'getItem' | 'removeItem'>): string => {
  try {
    const path = storage.getItem(KEY)
    storage.removeItem(KEY)
    return path?.startsWith('/') && !path.startsWith('//') ? path : '/'
  } catch {
    return '/'
  }
}
