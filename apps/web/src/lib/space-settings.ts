import { spacePath } from './space-types'

/** A section of a space's settings (ADR-0031): its address, its name, and whether only admins see it. */
export type SettingsSection = {
  id: SectionId
  label: string
  /** Webhooks say where the space's data goes, and the agent policy what may run unapproved: only admins see them. */
  admins?: true
}

export const SECTION_IDS = [
  'geral',
  'tipos',
  'fluxo',
  'campos',
  'labels',
  'formularios',
  'automacoes',
  'webhooks',
  'agentes',
  'pessoas'
] as const
export type SectionId = (typeof SECTION_IDS)[number]

export const SECTIONS: readonly SettingsSection[] = [
  { id: 'geral', label: 'Geral' },
  { id: 'tipos', label: 'Tipos de card' },
  { id: 'fluxo', label: 'Fluxo' },
  { id: 'campos', label: 'Campos' },
  { id: 'labels', label: 'Labels' },
  { id: 'formularios', label: 'Formulários' },
  { id: 'automacoes', label: 'Automações' },
  { id: 'webhooks', label: 'Webhooks', admins: true },
  { id: 'agentes', label: 'Agentes', admins: true },
  { id: 'pessoas', label: 'Pessoas e papéis' }
]

/** The section an address names, or the first one for none or one that does not exist. */
export const sectionOf = (id: string | undefined): SectionId => SECTION_IDS.find((each) => each === id) ?? 'geral'

/** @example settingsPath('TEC', 'tipos') // '/espacos/TEC/configuracoes/tipos' */
export const settingsPath = (spaceKey: string, section: SectionId = 'geral'): string =>
  `${spacePath(spaceKey)}/configuracoes/${section}`

/**
 * Where an old `?aba=` address of a tab that moved into the settings goes now, so links in e-mails and
 * notifications keep opening the same thing; nothing for a tab that is still a tab.
 *
 * @example movedTab('TEC', 'pessoas') // '/espacos/TEC/configuracoes/pessoas'
 * @example movedTab('TEC', 'lista')   // undefined
 */
export const movedTab = (spaceKey: string, tab: string | null): string | undefined => {
  const moved = SECTION_IDS.find(
    (each) => each === tab && !['geral', 'tipos', 'fluxo', 'campos', 'labels'].includes(each)
  )
  return moved ? settingsPath(spaceKey, moved) : undefined
}
