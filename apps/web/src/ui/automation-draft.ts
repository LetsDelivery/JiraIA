import type { Automation, AutomationAction, AutomationInput } from '@/api/intake'

/**
 * A rule being edited. Every select is a string here — empty means "none chosen" — and `payload`
 * turns it into what the API takes, dropping what a kind does not use.
 */
export type ActionDraft = {
  type: AutomationAction['type']
  spaceId: string
  typeId: string
  stateId: string
  title: string
  description: string
  /** `delivers:inward` and the like; empty for no link. */
  link: string
  comment: string
  channelId: string
  text: string
}

export type Draft = {
  name: string
  enabled: boolean
  trigger: 'card_created' | 'state_changed' | 'field_changed'
  toStateId: string
  toGroup: string
  field: string
  onlyType: string
  onlyLabel: string
  onlyPriority: string
  actions: ActionDraft[]
}

export const emptyAction = (type: ActionDraft['type'], spaceId: string): ActionDraft => ({
  type,
  spaceId,
  typeId: '',
  stateId: '',
  title: '{{card.title}}',
  description: '{{card.description}}',
  link: type === 'move_linked' ? 'delivers:outward' : '',
  comment: '',
  channelId: '',
  text: type === 'slack' ? '<{{card.url}}|{{card.key}}> {{card.title}}' : ''
})

const _fromAction = (action: AutomationAction, spaceId: string): ActionDraft => {
  const draft = emptyAction(action.type, spaceId)
  const values: Partial<ActionDraft> = { ...(action as Partial<ActionDraft>) }
  if (action.type === 'create_card') {
    values.link = action.link ? `${action.link.type}:${action.link.direction}` : ''
  }
  if (action.type === 'move_linked') {
    values.link = `${action.linkType}:${action.direction}`
  }
  if (action.type === 'comment') {
    values.text = action.body
  }
  return {
    ...draft,
    ...(Object.fromEntries(
      Object.entries(values).filter(([, value]) => typeof value === 'string')
    ) as Partial<ActionDraft>)
  }
}

const _triggerDraft = (trigger: Automation['trigger']) => ({
  trigger: trigger.type,
  toStateId: trigger.type === 'state_changed' ? (trigger.toStateId ?? '') : '',
  toGroup: trigger.type === 'state_changed' ? (trigger.toGroup ?? '') : '',
  field: trigger.type === 'field_changed' ? trigger.field : 'priority'
})

const _conditionsDraft = (conditions: Automation['conditions']) => ({
  onlyType: conditions.flatMap((each) => (each.type === 'type_is' ? each.typeIds : []))[0] ?? '',
  onlyLabel: conditions.flatMap((each) => (each.type === 'label_has' ? [each.label] : []))[0] ?? '',
  onlyPriority: conditions.flatMap((each) => (each.type === 'priority_is' ? each.priorities : []))[0] ?? ''
})

export const draftOf = (spaceId: string, rule?: Automation): Draft => ({
  name: rule?.name ?? '',
  enabled: rule?.enabled ?? true,
  ..._triggerDraft(rule?.trigger ?? { type: 'state_changed' }),
  ..._conditionsDraft(rule?.conditions ?? []),
  actions: rule?.actions.map((action) => _fromAction(action, spaceId)) ?? [emptyAction('comment', spaceId)]
})

const _trigger = (draft: Draft): AutomationInput['trigger'] => {
  if (draft.trigger === 'state_changed') {
    return {
      type: 'state_changed',
      ...(draft.toStateId ? { toStateId: draft.toStateId } : {}),
      ...(draft.toGroup ? { toGroup: draft.toGroup as 'done' } : {})
    }
  }
  return draft.trigger === 'field_changed' ? { type: 'field_changed', field: draft.field } : { type: 'card_created' }
}

const _conditions = (draft: Draft): NonNullable<AutomationInput['conditions']> => [
  ...(draft.onlyType ? [{ type: 'type_is' as const, typeIds: [draft.onlyType] }] : []),
  ...(draft.onlyLabel.trim() ? [{ type: 'label_has' as const, label: draft.onlyLabel.trim() }] : []),
  ...(draft.onlyPriority ? [{ type: 'priority_is' as const, priorities: [draft.onlyPriority as 'high'] }] : [])
]

const _link = (value: string) => {
  const [type, direction] = value.split(':')
  return { type: type as 'delivers', direction: (direction === 'inward' ? 'inward' : 'outward') as 'inward' }
}

const _action = (action: ActionDraft): AutomationAction => {
  const builders: Record<ActionDraft['type'], () => AutomationAction> = {
    create_card: () => ({
      type: 'create_card',
      spaceId: action.spaceId,
      title: action.title,
      description: action.description,
      ...(action.typeId ? { typeId: action.typeId } : {}),
      ...(action.stateId ? { stateId: action.stateId } : {}),
      ...(action.link ? { link: _link(action.link) } : {})
    }),
    set_state: () => ({ type: 'set_state', stateId: action.stateId }),
    move_linked: () => {
      const link = _link(action.link)
      return {
        type: 'move_linked',
        linkType: link.type,
        direction: link.direction,
        spaceId: action.spaceId,
        stateId: action.stateId,
        comment: action.comment
      }
    },
    comment: () => ({ type: 'comment', body: action.text }),
    slack: () => ({ type: 'slack', channelId: action.channelId, text: action.text })
  }
  return builders[action.type]()
}

export const payload = (draft: Draft): AutomationInput => ({
  name: draft.name.trim(),
  enabled: draft.enabled,
  trigger: _trigger(draft),
  conditions: _conditions(draft),
  actions: draft.actions.map(_action)
})
