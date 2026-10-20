import type { SpaceSummary } from '@/api/requests'
import { html } from '@/lib/html'
import { SPACE_TYPE_LABEL, spacePath } from '@/lib/space-types'

import { starButton } from './star'

/** A space as a card, with the caller's star. Solid surface: cards hold content, glass is for what floats. */
export const spaceCard = (space: SpaceSummary) => html`
  <a class="card card-link" href="${spacePath(space.key)}">
    <div class="card-head">
      <div class="stack-tight">
        <span class="key">${space.key}</span>
        <h3 class="card-title">${space.name}</h3>
      </div>
      ${starButton(space)}
    </div>
    <p class="card-text">${SPACE_TYPE_LABEL[space.type]}${space.lead ? html` · ${space.lead.name}` : ''}</p>
  </a>
`

export const spaceGrid = (spaces: readonly SpaceSummary[]) =>
  html`<div class="grid">${spaces.map((space) => spaceCard(space))}</div>`
