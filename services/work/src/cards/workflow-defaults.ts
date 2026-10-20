import type { SpaceType } from '../spaces/schemas.js'
import type { StateGroup } from './schemas.js'

export type WorkflowTemplate = { states: readonly [name: string, group: StateGroup][]; types: readonly string[] }

/**
 * The workflow a new space starts with, by type — a sensible board on day one, configurable after.
 * Close to what each kind of Jira space starts with, in the words the areas use.
 */
export const DEFAULT_WORKFLOWS: Record<SpaceType, WorkflowTemplate> = {
  software: {
    states: [
      ['Backlog', 'not_started'],
      ['A fazer', 'not_started'],
      ['Em andamento', 'in_progress'],
      ['Em revisão', 'in_progress'],
      ['Concluído', 'done']
    ],
    types: ['História', 'Tarefa', 'Bug', 'Epic']
  },
  business: {
    states: [
      ['A fazer', 'not_started'],
      ['Em andamento', 'in_progress'],
      ['Concluído', 'done']
    ],
    types: ['Tarefa']
  },
  product_discovery: {
    states: [
      ['Ideias', 'not_started'],
      ['Em descoberta', 'in_progress'],
      ['Pronto para entrega', 'in_progress'],
      ['Entregue', 'done'],
      ['Arquivado', 'cancelled']
    ],
    types: ['Ideia']
  },
  service_desk: {
    states: [
      ['Aberto', 'not_started'],
      ['Em atendimento', 'in_progress'],
      ['Aguardando cliente', 'in_progress'],
      ['Resolvido', 'done']
    ],
    types: ['Solicitação', 'Incidente']
  }
}

/**
 * The workflows Let's runs in Jira today (backlog/fluxo-jira.md, 2026-09-29), for the seed and,
 * later, for the migration's check that nothing was lost.
 */
export const LETS_WORKFLOWS: Record<'REQ' | 'PRD' | 'TEC', WorkflowTemplate> = {
  REQ: {
    states: [
      ['🧞‍♂️ Itens solicitados', 'not_started'],
      ['🚨 Itens priorizados', 'in_progress'],
      ['Itens despriorizados', 'cancelled'],
      ['🚀 Itens concluídos', 'done']
    ],
    types: ['Requisição']
  },
  PRD: {
    states: [
      ['Backlog', 'not_started'],
      ['Priorizado', 'not_started'],
      ['Especificação', 'in_progress'],
      ['Em UX/UI', 'in_progress'],
      ['Em validação', 'in_progress'],
      ['Em refinamento', 'in_progress'],
      ['Em Delivery', 'in_progress'],
      ['Preparando para lançar', 'in_progress'],
      ['Lançado', 'done'],
      ['Bloqueado', 'in_progress']
    ],
    types: ['Oportunidade', 'Subtarefa']
  },
  TEC: {
    states: [
      ['BACKLOG', 'not_started'],
      ['NÃO INICIADO', 'not_started'],
      ['EM PROGRESSO', 'in_progress'],
      ['REVISAR', 'in_progress'],
      ['IMPEDIMENTO', 'in_progress'],
      ['CONCLUÍDO', 'done'],
      ['CANCELADO', 'cancelled']
    ],
    types: ['Epic', 'História', 'Tarefa', 'Subtarefa', 'Bug', 'Spike', 'Data']
  }
}
