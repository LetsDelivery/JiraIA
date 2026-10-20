import { describe, expect, it } from 'vitest'

import { describeAction, describeTrigger, type Names, stepLabel } from './automations'

const names: Names = {
  state: (id) => ({ s1: 'Preparando para lançar', s2: 'Backlog' })[id] ?? id,
  space: (id) => ({ prd: 'PRD' })[id] ?? id,
  type: (id) => ({ t1: 'Oportunidade' })[id] ?? id,
  channel: (id) => ({ c1: '#product_updates' })[id] ?? id
}

describe('a rule as a sentence', () => {
  it('reads the trigger', () => {
    expect(describeTrigger({ type: 'card_created' }, names)).toBe('Quando um card é criado')
    expect(describeTrigger({ type: 'state_changed', toGroup: 'done' }, names)).toBe(
      'Quando um card vai para um estado concluído'
    )
    expect(describeTrigger({ type: 'state_changed', toStateId: 's2' }, names)).toBe('Quando um card vai para “Backlog”')
  })

  it('reads the actions the cut-over needs', () => {
    expect(
      describeAction(
        {
          type: 'create_card',
          spaceId: 'prd',
          typeId: 't1',
          stateId: 's2',
          title: '',
          description: '',
          link: { type: 'delivers', direction: 'inward' }
        },
        names
      )
    ).toBe('Cria um card em PRD (Oportunidade, Backlog) que entrega este')
    expect(
      describeAction(
        { type: 'move_linked', linkType: 'delivers', direction: 'outward', spaceId: 'prd', stateId: 's1', comment: '' },
        names
      )
    ).toBe('Leva os cards de PRD que este entrega para “Preparando para lançar”')
    expect(describeAction({ type: 'slack', channelId: 'c1', text: 'x' }, names)).toBe('Publica em #product_updates')
  })

  it('reads a run step', () => {
    expect(stepLabel({ action: 'create_card', detail: 'PRD-11' })).toBe('Criou PRD-11')
    expect(stepLabel({ action: 'move_linked', detail: '' })).toBe('Nenhum card vinculado para mover')
  })
})
