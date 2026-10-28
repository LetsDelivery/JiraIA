import { describe, expect, it } from 'bun:test'

import { fakeIssue } from '../import/atlassian-source.js'
import { jiraWorkflowOf } from '../import/jira-workflow.js'

/** Etapa 8c: a project's workflow as Jira has it, in an order a person reads (ADR-0036, ADR-0037). */
const status = (name: string, key: string) => ({ name, statusCategory: { key } })
const card = (status: string, type: string) =>
  fakeIssue({
    id: status,
    key: `PRD-${status.length}`,
    project: 'PRD',
    updated: '',
    issue: { fields: { status: { name: status, statusCategory: { key: 'new' } }, issuetype: { name: type } } }
  })

describe('a Jira workflow', () => {
  const workflow = jiraWorkflowOf(
    {
      id: '1',
      key: 'PRD',
      name: 'Discovery Board',
      issueTypes: [{ name: 'Oportunidade' }, { name: 'Subtarefa', subtask: true }]
    },
    [
      {
        name: 'Oportunidade',
        statuses: [
          status('Lançado', 'done'),
          status('Em UX/UI', 'indeterminate'),
          status('Backlog', 'new'),
          status('Especificação', 'indeterminate')
        ]
      },
      { name: 'Subtarefa', subtask: true, statuses: [status('Feito', 'done'), status('Para fazer', 'new')] }
    ],
    [card('Backlog', 'Oportunidade')]
  )

  it('lists every status, unused ones too, from not started to done, in the order LET’S wrote for the project', () => {
    expect(workflow.states.map((state) => state.name)).toEqual([
      'Backlog',
      'Para fazer',
      'Especificação',
      'Em UX/UI',
      'Lançado',
      'Feito'
    ])
  })

  it('keeps the sub-task level of each issue type, and leaves sub-task statuses off a business board', () => {
    expect(workflow.types).toEqual([
      { name: 'Oportunidade', subtask: false },
      { name: 'Subtarefa', subtask: true }
    ])
    expect(workflow.boardStates).toEqual(['Backlog', 'Especificação', 'Em UX/UI', 'Lançado'])
  })
})
