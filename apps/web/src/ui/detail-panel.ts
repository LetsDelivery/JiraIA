import { type Html, html } from '@/lib/html'

type Panel = {
  /** The heading; markup so a `<label>` or a count can sit in it. */
  title: Html | string
  body: Html
  /** Buttons on the right of the heading. */
  actions?: Html
  /** `data-*` hooks the section's binding looks for. */
  attributes?: Html
}

/**
 * One section of the card: a bordered surface with its heading on a bar, so each part of the card
 * reads as its own block instead of loose text on the dialog.
 */
export const detailPanel = (panel: Panel): Html => html`
  <section class="detail-panel" ${panel.attributes ?? ''}>
    <header class="detail-panel-head">
      <h3 class="detail-panel-title">${panel.title}</h3>
      ${panel.actions ?? ''}
    </header>
    <div class="detail-panel-body">${panel.body}</div>
  </section>
`
