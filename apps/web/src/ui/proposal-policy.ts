import { type ItemKind, proposalsRead, proposalsWrite } from '@/api/proposals'
import { type Html, html } from '@/lib/html'
import { KIND_LABEL } from '@/lib/proposals'
import { refusalSentence } from '@/lib/refusal'

import { toast } from './toast'

const KINDS = Object.keys(KIND_LABEL) as ItemKind[]

/**
 * The space's Agentes tab, for its admins (ADR-0019): which kinds of change agents apply here without
 * a person approving. Nothing by default; every other proposal waits in Propostas.
 */
export const proposalPolicyPanel = async (spaceId: string): Promise<Html> => {
  const { autoApply } = await proposalsRead.policy(spaceId)
  return html`
    <section class="section">
      <div class="section-head">
        <div>
          <h2>Agentes</h2>
          <p class="muted">Agentes propõem mudanças e uma pessoa que escreve no espaço aprova em <a href="/propostas">Propostas</a>. Marque o que pode ser aplicado sem aprovação.</p>
        </div>
      </div>
      <fieldset class="policy-kinds" data-policy>
        <legend class="label">Aplicar sem aprovação</legend>
        ${KINDS.map(
          (kind) => html`
            <label><input type="checkbox" class="checkbox" data-policy-kind="${kind}" ${autoApply.includes(kind) ? html`checked` : ''} />${KIND_LABEL[kind]}</label>`
        )}
      </fieldset>
    </section>
  `
}

export const bindProposalPolicy = (root: HTMLElement, spaceId: string): void => {
  root.querySelector('[data-policy]')?.addEventListener('change', () => {
    const chosen = [...root.querySelectorAll<HTMLInputElement>('[data-policy-kind]:checked')].map(
      (input) => input.dataset.policyKind as ItemKind
    )
    void proposalsWrite
      .setPolicy(spaceId, chosen)
      .then(() => toast('Preferência dos agentes salva.'))
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  })
}
