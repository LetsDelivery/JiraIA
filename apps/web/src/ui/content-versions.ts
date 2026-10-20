import { drawRead, drawWrite, type Version, type VersionSummary } from '@/api/draw'
import { diffLines, diffSummary } from '@/lib/diff'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'

import { toast } from './toast'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

const REASON: Record<VersionSummary['reason'], string> = {
  auto: 'automática',
  manual: 'salva à mão',
  restore: 'restaurada'
}

export type VersionsContext = {
  contentId: string
  canWrite: boolean
  /** The text on screen now, to compare a version with. */
  currentText: () => string
  /** Sets a version's content in the live document — the page editor's, or the board's. */
  apply: (json: Record<string, unknown>) => void
  /** Saves what is waiting to be saved, so a version taken now holds the latest text. */
  flush: () => Promise<void>
}

/** The version being compared, per page; it survives the panel's re-renders. */
let open: { contentId: string; version: Version } | undefined

const item = (version: VersionSummary, selected: boolean): Html => html`
  <li>
    <button type="button" class="page-version ${selected ? 'is-active' : ''}" data-version="${version.number}" aria-pressed="${selected}">
      <strong>v${version.number}${version.name ? html` · ${version.name}` : ''}</strong>
      <span>${version.createdBy.name} · ${WHEN.format(new Date(version.createdAt))}</span>
      <small class="muted">${REASON[version.reason]}${version.restoredFrom ? ` da v${version.restoredFrom}` : ''}</small>
    </button>
  </li>
`

/** The open version against the page as it is now, line by line (escopo-mvp 5.4). */
const comparison = (version: Version, context: VersionsContext): Html => {
  const lines = diffLines(version.contentText, context.currentText())
  const summary = diffSummary(lines)
  return html`
    <div class="page-diff" aria-label="Comparação com a página atual">
      <p class="muted">v${version.number} → agora: <span class="diff-added">+${summary.added}</span> <span class="diff-removed">−${summary.removed}</span></p>
      <pre class="diff">${lines.map((line) => html`<span class="diff-${line.kind}">${line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}${line.text}\n</span>`)}</pre>
      ${context.canWrite ? html`<button type="button" class="button button-secondary" data-restore="${version.number}">Restaurar a v${version.number}</button>` : ''}
    </div>
  `
}

export const versionsPanel = (versions: readonly VersionSummary[], context: VersionsContext): Html => {
  const shown = open?.contentId === context.contentId ? open.version : undefined
  return html`
    <section class="stack-tight" data-page-versions>
      ${context.canWrite ? html`<button type="button" class="button button-secondary align-start" data-save-version>Salvar versão agora</button>` : ''}
      ${versions.length ? html`<ul class="page-versions">${versions.map((version) => item(version, version.number === shown?.number))}</ul>` : html`<p class="muted">Nenhuma versão ainda. A primeira é salva ao editar.</p>`}
      ${shown ? comparison(shown, context) : ''}
    </section>
  `
}

/**
 * Restoring sets the old content in the live editor — so it reaches everyone editing as a change —
 * and the API records it as a new version (ADR-0009).
 */
const restore = async (context: VersionsContext, number: number): Promise<void> => {
  if (!confirm(`Restaurar a v${number}? O conteúdo atual continua salvo nas versões.`)) {
    return
  }
  const version = await drawWrite.restoreVersion(context.contentId, number)
  context.apply(version.contentJson)
  open = undefined
  toast(`v${number} restaurada como v${version.number}.`)
}

export const bindVersionsPanel = (root: HTMLElement, context: VersionsContext, redraw: () => void): void => {
  const panel = root.querySelector<HTMLElement>('[data-page-versions]')
  const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
  panel?.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-version], [data-restore], [data-save-version]'
    )
    if (target?.dataset.version) {
      void drawRead
        .version(context.contentId, Number(target.dataset.version))
        .then((version) => {
          open = { contentId: context.contentId, version }
          redraw()
        })
        .catch(refuse)
    } else if (target?.dataset.restore) {
      void restore(context, Number(target.dataset.restore)).catch(refuse)
    } else if (target?.hasAttribute('data-save-version')) {
      void context
        .flush()
        .then(() => drawWrite.saveVersion(context.contentId))
        .then((version) => toast(`v${version.number} salva.`))
        .catch(refuse)
    }
  })
}
