/**
 * The Google Workspace domains whose people are LET'S: `uselets.com` and `lets.delivery` (ADR-0005,
 * ADR-0026). One rule for who signs in and who can be invited.
 */

/**
 * @example domainOf('Ana@Lets.Delivery')   // 'lets.delivery'
 */
export const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1).toLowerCase()

/**
 * Whether an address is of one of the allowed domains — its own domain, not a suffix of it, so
 * `ana@evil-uselets.com` is not `uselets.com`.
 *
 * @example isAllowedAddress('ana@lets.delivery', ['uselets.com', 'lets.delivery'])   // true
 */
export const isAllowedAddress = (email: string, domains: readonly string[]): boolean =>
  email.includes('@') && domains.includes(domainOf(email))

/**
 * The domains as a sentence names them.
 *
 * @example domainList(['uselets.com', 'lets.delivery'])   // 'uselets.com or lets.delivery'
 */
export const domainList = (domains: readonly string[]): string => domains.join(' or ')
