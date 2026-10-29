import { describe, expect, it } from 'bun:test'

import { type HistoryNames, historyChangeOf, historyEventsOf } from '../import/jira-history-mapping.js'

/** Etapa 8d: Jira's changelog items as the changes JiraIA's audit trail writes (ADR-0036). */
const names: HistoryNames = {
  stateId: (name) =>
    new Map([
      ['NÃO INICIADO', 's-todo'],
      ['EM PROGRESSO', 's-doing']
    ]).get(name),
  typeId: (name) => new Map([['Story', 't-story']]).get(name),
  memberOf: (accountId) => new Map([['ana', 'm-ana']]).get(accountId),
  sprintId: (id) =>
    new Map([
      [327, 'sp-34'],
      [360, 'sp-35']
    ]).get(id),
  cardId: (issueId) => new Map([['13683', 'c-epic']]).get(issueId),
  fieldId: (jiraId) => new Map([['customfield_10650', 'f-squad']]).get(jiraId),
  storyPointsField: 'customfield_10016',
  sprintField: 'customfield_10020',
  rankField: 'customfield_10019'
}
const of = (item: Record<string, unknown>) => historyChangeOf(item, names, 'TEC-216')

describe('a Jira changelog item', () => {
  it('moves a card between states by their JiraIA ids, as the board does', () => {
    expect(of({ field: 'status', fromString: 'NÃO INICIADO', toString: 'EM PROGRESSO' })).toEqual({
      action: 'moved',
      key: 'stateId',
      change: { before: 's-todo', after: 's-doing' }
    })
  })

  it('names people, sprints, parents, points and custom fields by JiraIA’s ids', () => {
    expect(of({ field: 'assignee', to: 'ana' })?.change).toEqual({ before: null, after: 'm-ana' })
    expect(
      of({ field: 'Sprint', fieldtype: 'custom', fieldId: 'customfield_10020', from: '327', to: '327, 360' })
    ).toMatchObject({ key: 'sprintId', change: { before: 'sp-34', after: 'sp-35' } })
    expect(of({ field: 'IssueParentAssociation', to: '13683' })).toMatchObject({
      key: 'parentId',
      change: { after: 'c-epic' }
    })
    expect(
      of({ field: 'Story point estimate', fieldtype: 'custom', fieldId: 'customfield_10016', toString: '5' })?.change
    ).toEqual({ before: null, after: 5 })
    expect(of({ field: 'Squad', fieldtype: 'custom', fieldId: 'customfield_10650', toString: 'Core' })).toMatchObject({
      key: 'field:f-squad',
      change: { after: 'Core' }
    })
  })

  it('keeps a move from another project, a link and an attachment as their own actions', () => {
    expect(of({ field: 'Key', fromString: 'LD-17', toString: 'TEC-216' })).toEqual({
      action: 'transferred',
      key: 'key',
      change: { before: 'LD-17', after: 'TEC-216' }
    })
    expect(of({ field: 'Link', to: 'TEC-9', toString: 'This work item is blocked by TEC-9' })?.change).toEqual({
      before: null,
      after: { type: 'blocks', from: 'TEC-216', to: 'TEC-9' }
    })
    expect(of({ field: 'Attachment', to: '1', toString: 'tela.png' })).toMatchObject({
      action: 'attached',
      change: { after: 'tela.png' }
    })
  })

  it('drops the board’s reordering, and keeps under Jira’s name what JiraIA has no field for', () => {
    expect(of({ field: 'Rank', toString: 'Ranked higher' })).toBeNull()
    expect(of({ field: 'Classificação', fieldtype: 'custom', fieldId: 'customfield_10019' })).toBeNull()
    expect(of({ field: 'resolution', toString: 'Feito' })).toEqual({
      action: 'updated',
      key: 'jira:resolution',
      change: { before: null, after: 'Feito' }
    })
  })

  it('groups an entry’s items into one event per action', () => {
    const events = historyEventsOf(
      [
        { field: 'status', fromString: 'NÃO INICIADO', toString: 'EM PROGRESSO' },
        { field: 'assignee', to: 'ana' },
        { field: 'resolution', toString: 'Feito' },
        { field: 'Rank' }
      ],
      names,
      'TEC-216'
    )
    expect(events.map((event) => [event.action, Object.keys(event.changes)])).toEqual([
      ['moved', ['stateId']],
      ['updated', ['assigneeId', 'jira:resolution']]
    ])
  })
})
