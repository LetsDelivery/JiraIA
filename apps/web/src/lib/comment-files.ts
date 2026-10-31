/**
 * Which of the card's attachments a comment cites. A comment cites a file as `📎 name` — an imported
 * one where Jira had the picture, a new one where a file was pasted — and the file itself is the
 * card's attachment of that name, read from the card's own attachments like the Anexos panel; nothing
 * is fetched from Jira or from the import's copy.
 */
export const FILE_MARK = '📎 '

type Named = { name: string; createdAt: string }

export type Citation<T> = { start: number; end: number; file: T }

/** Of several files with one name, the one sent nearest the comment: a screenshot is pasted as it is cited. */
const nearest = <T extends Named>(files: readonly T[], at: number): T | undefined =>
  [...files].sort((a, b) => Math.abs(Date.parse(a.createdAt) - at) - Math.abs(Date.parse(b.createdAt) - at))[0]

/** The longest name the text continues with, so `tela.png` does not stop `tela.png.zip` short. */
const named = <T extends Named>(text: string, from: number, files: readonly T[]): T[] => {
  const matches = files.filter((file) => text.startsWith(file.name, from))
  const longest = Math.max(0, ...matches.map((file) => file.name.length))
  return matches.filter((file) => file.name.length === longest)
}

/**
 * The files a text cites, in order, with where each citation sits (the mark included).
 *
 * @example citations('veja 📎 tela.png', files, comment.createdAt)   // [{ start: 5, end: 17, file }]
 */
export const citations = <T extends Named>(text: string, files: readonly T[], createdAt: string): Citation<T>[] => {
  const found: Citation<T>[] = []
  let at = text.indexOf(FILE_MARK)
  while (at !== -1) {
    const from = at + FILE_MARK.length
    const file = nearest(named(text, from, files), Date.parse(createdAt))
    if (file) {
      found.push({ start: at, end: from + file.name.length, file })
    }
    at = text.indexOf(FILE_MARK, file ? from + file.name.length : from)
  }
  return found
}

/** What a clipboard calls every screenshot it holds. */
const GENERIC = /^image\.\w+$/i

/**
 * The name a pasted file is kept under, so its citation finds it alone: its own, unless the clipboard
 * gave the usual `image.png` or the card already has one so named — then the moment it was pasted is
 * added, as Jira does: `image-20261031-174210.png`, then `-2` for a second that second.
 */
export const pastedName = (file: { name: string; type: string }, now: Date, taken: ReadonlySet<string>): string => {
  if (file.name && !GENERIC.test(file.name) && !taken.has(file.name)) {
    return file.name
  }
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const dot = file.name.lastIndexOf('.')
  const extension = dot > 0 ? file.name.slice(dot) : `.${file.type.split('/')[1] ?? 'bin'}`
  const base = dot > 0 ? file.name.slice(0, dot) : file.name || 'arquivo'
  const stem = `${base}-${stamp}`
  let name = `${stem}${extension}`
  for (let count = 2; taken.has(name); count += 1) {
    name = `${stem}-${count}${extension}`
  }
  return name
}
