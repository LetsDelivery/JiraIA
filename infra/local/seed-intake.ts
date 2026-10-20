import type { Caller } from '@jiraia/http'

import type { buildService } from '../../services/work/src/container.js'

type Service = ReturnType<typeof buildService>
type Spaces = { req: string; prd: string; tec: string }

/**
 * Etapa 5's seed: the REQ's intake form and the two rules the cut-over needs (escopo-mvp 4.1–4.4),
 * with `#product_updates` connected to a placeholder webhook — the harness prints what it would post.
 *
 * The form's questions are a proposal for Produto to confirm against the Jira form it replaces.
 */
export const seedIntake = async (service: Service, caller: Caller, spaces: Spaces): Promise<void> => {
  const ids = await _ids(service, caller, spaces)
  const area = await service.fields.create(caller, spaces.req, {
    name: 'Área solicitante',
    kind: 'select',
    options: ['CS', 'Comercial', 'Financeiro', 'Operações', 'Marketing', 'Jurídico', 'Tecnologia', 'Outra'],
    typeIds: []
  })
  await service.forms.create(caller, spaces.req, {
    name: 'Pedido para Produto',
    description: 'Conte o que você precisa. O pedido chega em Requisições e Produto faz a triagem.',
    typeId: ids.requisicao,
    stateId: null,
    labels: ['business-form'],
    enabled: true,
    questions: [
      {
        id: 'titulo',
        label: 'O que você precisa?',
        help: 'Uma frase, como o título de um card.',
        required: true,
        target: 'title'
      },
      { id: 'area', label: 'De qual área você é?', help: '', required: true, target: `field:${area.id}` },
      {
        id: 'problema',
        label: 'Qual é o problema hoje?',
        help: 'O que acontece e com quem.',
        required: true,
        target: 'description'
      },
      {
        id: 'impacto',
        label: 'Qual o impacto se nada mudar?',
        help: 'Clientes, receita, horas da equipe.',
        required: false,
        target: 'description'
      },
      { id: 'prazo', label: 'Existe uma data limite?', help: '', required: false, target: 'dueDate' }
    ]
  })
  const channel = await service.slack.add(caller, {
    name: '#product_updates',
    webhookUrl: 'https://hooks.slack.com/services/LOCAL/EXAMPLE/seed'
  })
  await _rules(service, caller, spaces, { ...ids, channelId: channel.id })
}

const _ids = async (service: Service, caller: Caller, spaces: Spaces) => {
  const [req, prd] = await Promise.all([
    service.workflows.get(caller, spaces.req),
    service.workflows.get(caller, spaces.prd)
  ])
  const id = (list: readonly { id: string; name: string }[], name: string) =>
    list.find((each) => each.name === name)?.id ?? ''
  return {
    requisicao: id(req.types, 'Requisição'),
    priorizados: id(req.states, '🚨 Itens priorizados'),
    oportunidade: id(prd.types, 'Oportunidade'),
    backlog: id(prd.states, 'Backlog'),
    preparando: id(prd.states, 'Preparando para lançar')
  }
}

const _rules = async (
  service: Service,
  caller: Caller,
  spaces: Spaces,
  ids: Awaited<ReturnType<typeof _ids>> & { channelId: string }
) => {
  await service.automations.create(caller, spaces.req, {
    name: 'Requisição priorizada vira Oportunidade no PRD',
    enabled: true,
    trigger: { type: 'state_changed', toStateId: ids.priorizados },
    conditions: [],
    actions: [
      {
        type: 'create_card',
        spaceId: spaces.prd,
        typeId: ids.oportunidade,
        stateId: ids.backlog,
        title: '{{card.title}}',
        description: '{{card.description}}\n\nOrigem: {{card.key}}',
        link: { type: 'delivers', direction: 'inward' }
      },
      {
        type: 'slack',
        channelId: ids.channelId,
        text: ':rotating_light: <{{card.url}}|{{card.key}}> foi priorizado e virou <{{created.url}}|{{created.key}} {{created.title}}> no Discovery.'
      }
    ]
  })
  await service.automations.create(caller, spaces.tec, {
    name: 'Entrega concluída leva o PRD para Preparando para lançar',
    enabled: true,
    trigger: { type: 'state_changed', toGroup: 'done' },
    conditions: [],
    actions: [
      {
        type: 'move_linked',
        linkType: 'delivers',
        direction: 'outward',
        spaceId: spaces.prd,
        stateId: ids.preparando,
        comment: '{{card.key}} ({{card.title}}) foi concluído no Delivery Board.'
      }
    ]
  })
}
