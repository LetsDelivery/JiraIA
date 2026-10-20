import { describe, expect, it } from 'vitest'

import type { Automation } from '@/api/intake'

import { draftOf, emptyAction, payload } from './automation-draft'

const rule: Automation = {
  id: 'r1',
  spaceId: 'tec',
  owner: { id: 'm1', name: 'Admin' },
  name: 'TEC concluído → PRD',
  enabled: true,
  trigger: { type: 'state_changed', toGroup: 'done' },
  conditions: [{ type: 'label_has', label: 'okr' }],
  actions: [
    {
      type: 'move_linked',
      linkType: 'delivers',
      direction: 'outward',
      spaceId: 'prd',
      stateId: 's1',
      comment: '{{card.key}} concluído'
    },
    {
      type: 'create_card',
      spaceId: 'prd',
      title: '{{card.title}}',
      description: '',
      link: { type: 'delivers', direction: 'inward' }
    }
  ],
  updatedAt: '2026-10-17T12:00:00.000Z'
}

describe('a rule in the editor', () => {
  it('comes back as the same rule after a trip through the draft', () => {
    expect(payload(draftOf('tec', rule))).toEqual({
      name: rule.name,
      enabled: true,
      trigger: rule.trigger,
      conditions: rule.conditions,
      actions: rule.actions
    })
  })

  it('drops what an action kind does not use', () => {
    const draft = draftOf('req')
    draft.actions = [{ ...emptyAction('slack', 'req'), channelId: 'c1' }]
    expect(payload(draft).actions).toEqual([
      { type: 'slack', channelId: 'c1', text: '<{{card.url}}|{{card.key}}> {{card.title}}' }
    ])
  })
})
