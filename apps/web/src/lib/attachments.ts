/**
 * How the panel shows an attachment in place, instead of saving it: by its type, or by its extension
 * when the browser sent none (a `.md` often arrives as `application/octet-stream`).
 */
export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'none'

/** Text past this is not drawn: the viewer offers the download instead of freezing the tab. */
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024

type Rule = { kind: Exclude<PreviewKind, 'none'>; type: RegExp; extensions: Set<string> }

const extensions = (list: string): Set<string> => new Set(list.split(' '))

/** First match wins: an SVG is a picture before it is text. */
const RULES: readonly Rule[] = [
  { kind: 'image', type: /^image\//, extensions: extensions('png jpg jpeg gif webp avif bmp svg') },
  { kind: 'pdf', type: /^application\/pdf$/, extensions: extensions('pdf') },
  { kind: 'video', type: /^video\//, extensions: extensions('mp4 webm mov m4v') },
  { kind: 'audio', type: /^audio\//, extensions: extensions('mp3 wav ogg m4a aac flac') },
  {
    kind: 'text',
    type: /^(text\/|application\/(json|xml|yaml|x-yaml|javascript|x-sh|sql|graphql)$)/,
    extensions: extensions(
      'md markdown txt log csv tsv json xml yml yaml toml ini env sql sh ts tsx js jsx mjs cjs py rb go ' +
        'java kt php cs css scss html htm graphql proto diff patch'
    )
  }
]

/** "relatorio.final.PDF" → "pdf"; a name with no dot has none. */
export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * @example previewKind('fluxo.png', 'image/png')                        // 'image'
 * @example previewKind('notas.md', 'application/octet-stream')          // 'text'
 * @example previewKind('planilha.xlsx', 'application/vnd.ms-excel')     // 'none'
 */
export const previewKind = (name: string, contentType: string): PreviewKind => {
  const type = contentType.toLowerCase()
  const extension = extensionOf(name)
  const rule = RULES.find((candidate) => candidate.type.test(type) || candidate.extensions.has(extension))
  return rule?.kind ?? 'none'
}

/** "PDF", "MD", "XLSX" — the label a tile without a picture shows; "ARQUIVO" when there is no extension. */
export const typeLabel = (name: string): string => extensionOf(name).toUpperCase() || 'ARQUIVO'
