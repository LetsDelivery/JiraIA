import { PluginKey } from '@tiptap/pm/state'

import type { Member } from '@/api/requests'

import { type MenuItem, suggestionMenu } from './suggestion-menu'

type Person = MenuItem & { id: string }

/** `@` offers the organization's active members — people and agents (escopo-mvp 5.5). */
export const people = (members: readonly Member[]) => ({
  char: '@',
  pluginKey: new PluginKey('peopleSuggestion'),
  items: ({ query }: { query: string }): Person[] =>
    members
      .filter(
        (member) =>
          member.status === 'active' &&
          member.kind === 'person' &&
          member.name.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 8)
      .map((member) => ({ id: member.id, label: member.name, ...(member.kind === 'agent' ? { hint: 'Agente' } : {}) })),
  render: () => suggestionMenu<Person>('Pessoas')
})
