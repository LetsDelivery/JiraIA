import { accessRead } from '@/api/access'
import { read, spaceIdByKey } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { SECTIONS, type SectionId, sectionOf, settingsPath } from '@/lib/space-settings'
import { spacePath } from '@/lib/space-types'
import { accessPanel, bindAccessPanel } from '@/ui/access-panel'
import { automationsPanel, bindAutomationsPanel } from '@/ui/automations-panel'
import { bindCardTypesPanel, cardTypesPanel } from '@/ui/card-types-panel'
import { bindFieldsPanel, fieldsPanel } from '@/ui/fields-panel'
import { bindFormsPanel, formsPanel } from '@/ui/forms-panel'
import { icon } from '@/ui/icons'
import { bindLabelsPanel, labelsPanel } from '@/ui/labels-panel'
import { bindProposalPolicy, proposalPolicyPanel } from '@/ui/proposal-policy'
import { bindEditNotice, editNotice } from '@/ui/request-access'
import { bindGeneralPanel, generalPanel } from '@/ui/space-general'
import { bindWebhooksPanel, webhooksPanel } from '@/ui/webhooks-panel'
import { bindWorkflowPanel, workflowPanel } from '@/ui/workflow-panel'

import type { View } from './view'

type Section = {
  draw: (spaceId: string, manages: boolean) => Html | Promise<Html>
  bind: (root: HTMLElement, spaceId: string) => unknown
}

/** What each section draws and wires; they are the panels the space's tabs and dialogs had before. */
const PANELS: Record<SectionId, Section> = {
  geral: { draw: generalPanel, bind: bindGeneralPanel },
  tipos: { draw: cardTypesPanel, bind: bindCardTypesPanel },
  fluxo: { draw: workflowPanel, bind: bindWorkflowPanel },
  campos: { draw: fieldsPanel, bind: bindFieldsPanel },
  labels: { draw: labelsPanel, bind: bindLabelsPanel },
  formularios: { draw: formsPanel, bind: bindFormsPanel },
  automacoes: { draw: automationsPanel, bind: bindAutomationsPanel },
  webhooks: { draw: (spaceId) => webhooksPanel(spaceId), bind: bindWebhooksPanel },
  agentes: { draw: (spaceId) => proposalPolicyPanel(spaceId), bind: bindProposalPolicy },
  pessoas: {
    draw: (spaceId) => accessPanel('jiraia', spaceId),
    bind: (root, spaceId) => bindAccessPanel(root, 'jiraia', spaceId)
  }
}

const idOf = async (spaceKey: string): Promise<string> => {
  const id = await spaceIdByKey(spaceKey)
  if (!id) {
    throw { error: { code: 'NOT_FOUND', message: `Space ${spaceKey}` } }
  }
  return id
}

/** The section on screen: an admins-only one a member cannot see reads as the first. */
const shown = (section: string | undefined, manages: boolean): SectionId => {
  const id = sectionOf(section)
  return SECTIONS.find((each) => each.id === id)?.admins && !manages ? 'geral' : id
}

const nav = (spaceKey: string, current: SectionId, manages: boolean): Html => html`
  <nav class="settings-nav" aria-label="Seções das configurações">
    ${SECTIONS.filter((each) => manages || !each.admins).map(
      (each) =>
        html`<a class="settings-link" href="${settingsPath(spaceKey, each.id)}" ${each.id === current ? html`aria-current="page"` : ''}>${each.label}</a>`
    )}
  </nav>
`

const render = async ({ spaceKey = '', section }: Record<string, string>): Promise<Html> => {
  const spaceId = await idOf(spaceKey)
  const [space, access, notice] = await Promise.all([
    read.space(spaceId),
    accessRead.mine('jiraia', spaceId),
    editNotice('jiraia', spaceId)
  ])
  const current = shown(section, access.canManage)
  const label = SECTIONS.find((each) => each.id === current)?.label ?? ''
  return html`
    <header class="page-header">
      <a class="back-link" href="${spacePath(space.key)}">${icon('chevronLeft', 16)}${space.name}</a>
      <div class="row"><span class="key">${space.key}</span><h1>Configurações</h1></div>
    </header>
    ${notice}
    <div class="settings-layout">
      ${nav(space.key, current, access.canManage)}
      <section class="settings-body" aria-labelledby="settings-title">
        <h2 id="settings-title">${label}</h2>
        ${await PANELS[current].draw(spaceId, access.canManage)}
      </section>
    </div>
  `
}

const bind = (root: HTMLElement, { spaceKey = '', section }: Record<string, string>): void => {
  void idOf(spaceKey).then(async (spaceId) => {
    const { canManage } = await accessRead.mine('jiraia', spaceId)
    bindEditNotice(root, 'jiraia', spaceId)
    await PANELS[shown(section, canManage)].bind(root, spaceId)
  })
}

/**
 * A space's settings (ADR-0031): one place for what sets it up — the space, its card types, workflow
 * and fields, intake forms, automations, webhooks, agents and roles. Everyone who reads the space reads
 * them; its admins change them.
 */
export const spaceSettingsView: View = {
  path: '/espacos/:spaceKey/configuracoes/:section',
  title: 'Configurações do espaço',
  render,
  bind
}

/** `/configuracoes` with no section opens the first. */
export const spaceSettingsHomeView: View = { ...spaceSettingsView, path: '/espacos/:spaceKey/configuracoes' }
