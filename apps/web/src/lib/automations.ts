import type { AutomationAction, Run, Trigger } from '@/api/intake'

/**
 * How a rule reads on screen, in pt-BR (escopo-mvp 4.2). The API stores ids and kinds; these turn
 * them into the sentence a person checks a rule by: "Quando … → Então …".
 */
export type Names = {
  state: (id: string) => string
  space: (id: string) => string
  type: (id: string) => string
  channel: (id: string) => string
}

export const GROUP_LABEL: Record<string, string> = {
  not_started: 'não iniciado',
  in_progress: 'em andamento',
  done: 'concluído',
  cancelled: 'cancelado'
}

export const LINK_READING: Record<string, Record<'outward' | 'inward', string>> = {
  relates: { outward: 'relaciona-se com', inward: 'relaciona-se com' },
  blocks: { outward: 'bloqueia', inward: 'é bloqueado por' },
  duplicates: { outward: 'duplica', inward: 'é duplicado por' },
  delivers: { outward: 'entrega', inward: 'é entregue por' },
  causes: { outward: 'causa', inward: 'é causado por' }
}

/**
 * @example describeTrigger({ type: 'state_changed', toGroup: 'done' }, names)   // 'Quando um card vai para um estado concluído'
 */
export const describeTrigger = (trigger: Trigger, names: Names): string => {
  if (trigger.type === 'card_created') {
    return 'Quando um card é criado'
  }
  if (trigger.type === 'field_changed') {
    return `Quando o campo ${trigger.field} muda`
  }
  if (trigger.toStateId) {
    return `Quando um card vai para “${names.state(trigger.toStateId)}”`
  }
  return trigger.toGroup
    ? `Quando um card vai para um estado ${GROUP_LABEL[trigger.toGroup] ?? trigger.toGroup}`
    : 'Quando um card muda de estado'
}

const _create = (action: Extract<AutomationAction, { type: 'create_card' }>, names: Names): string => {
  const where = [action.typeId ? names.type(action.typeId) : '', action.stateId ? names.state(action.stateId) : '']
    .filter(Boolean)
    .join(', ')
  const link = action.link
    ? ` que ${LINK_READING[action.link.type]?.[action.link.direction === 'inward' ? 'outward' : 'inward'] ?? ''} este`
    : ''
  return `Cria um card em ${names.space(action.spaceId)}${where ? ` (${where})` : ''}${link}`
}

/**
 * @example describeAction({ type: 'slack', channelId: 'c', text: '…' }, names)   // 'Publica em #product_updates'
 */
export const describeAction = (action: AutomationAction, names: Names): string => {
  const sentences: Record<AutomationAction['type'], () => string> = {
    create_card: () => _create(action as Extract<AutomationAction, { type: 'create_card' }>, names),
    set_state: () => `Muda o estado para “${names.state((action as { stateId: string }).stateId)}”`,
    move_linked: () => {
      const move = action as Extract<AutomationAction, { type: 'move_linked' }>
      return `Leva os cards de ${names.space(move.spaceId)} que este ${LINK_READING[move.linkType]?.[move.direction] ?? ''} para “${names.state(move.stateId)}”`
    },
    comment: () => 'Comenta no card',
    slack: () => `Publica em ${names.channel((action as { channelId: string }).channelId)}`
  }
  return sentences[action.type]()
}

export const RUN_STATUS_LABEL: Record<Run['status'], string> = {
  succeeded: 'Executou',
  failed: 'Falhou',
  skipped: 'Condições não atendidas'
}

/**
 * One step of a run, as a sentence.
 *
 * @example stepLabel({ action: 'create_card', detail: 'PRD-11' })   // 'Criou PRD-11'
 */
export const stepLabel = (step: Run['steps'][number]): string => {
  const labels: Record<string, string> = {
    create_card: `Criou ${step.detail}`,
    set_state: `Mudou o estado de ${step.detail}`,
    move_linked: step.detail ? `Moveu ${step.detail}` : 'Nenhum card vinculado para mover',
    comment: `Comentou em ${step.detail}`,
    slack: 'Publicou no Slack'
  }
  return labels[step.action] ?? step.action
}
