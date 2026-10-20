/**
 * Yjs speaks bytes; the API and the WebSocket speak JSON, so updates travel as base64 (ADR-0009).
 *
 * @example fromBase64(toBase64(new Uint8Array([1, 2, 3])))   // Uint8Array [1, 2, 3]
 */
export const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
