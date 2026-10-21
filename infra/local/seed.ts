import { systemClock, uuidGenerator } from '@jiraia/core'
import { connectDatabase } from '@jiraia/db'
import { callerFromClaims } from '@jiraia/http'
import type { Priority } from '../../services/work/src/cards/schemas.js'
import { LETS_WORKFLOWS } from '../../services/work/src/cards/workflow-defaults.js'
import { buildService } from '../../services/work/src/container.js'
import { bootstrapOrganization } from '../../services/work/src/members/bootstrap.js'
import { auditEvents, organizations } from '../../services/work/src/schema.js'
import type { CardFilter, CardOrder } from '../../services/work/src/search/filter.schemas.js'
import {
  ALLOWED_EMAIL_DOMAIN,
  ALLOWED_EMAIL_DOMAINS,
  assertDevDatabase,
  DEV_DATABASE_URL,
  localClaims
} from './config.js'
import { seedIntake } from './seed-intake.js'

/**
 * A small organization to click through: the spaces of the product flow — the Discovery Board with
 * example opportunities on its board — and one
 * person per role. Sign in locally as any of them by email.
 *
 *     bun run seed            only when the database is empty
 *     bun run local:reset     drops the dev database and seeds again
 *
 * It drives the real services rather than writing rows, so the seed also leaves an audit trail and
 * cannot hold a state the API could not have produced.
 */
const url = process.env.DATABASE_URL ?? DEV_DATABASE_URL
assertDevDatabase(url)
const db = connectDatabase({ DATABASE_URL: url })

const [existing] = await db.select().from(organizations).limit(1)
if (existing) {
  console.error('  seed: the organization already exists; nothing to do (use local:reset to start over)')
  process.exit(0)
}

const admin = await bootstrapOrganization(
  { db, clock: systemClock, ids: uuidGenerator },
  { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin LET’S' } }
)
const service = buildService(
  {
    DATABASE_URL: url,
    AWS_REGION: 'us-east-1',
    ALLOWED_EMAIL_DOMAINS,
    ATTACHMENTS_BUCKET: 'local',
    REALTIME_URL: 'ws://localhost/realtime'
  },
  { db }
)
// The admin's first request, as if they had signed in with Google: it binds the bootstrapped row.
const caller = callerFromClaims(localClaims(admin.email ?? ''))

// The three spaces of the product flow, with the keys, types and workflows LET'S runs in Jira today.
const requisicoes = await service.spaces.create(
  caller,
  { key: 'REQ', name: 'Requisições', description: 'Pedidos das áreas para Produto', type: 'business' },
  LETS_WORKFLOWS.REQ
)
const discovery = await service.spaces.create(
  caller,
  {
    key: 'PRD',
    name: 'Discovery Board',
    description: 'A esteira de Produto: do insight ao lançamento',
    type: 'business'
  },
  LETS_WORKFLOWS.PRD
)
const delivery = await service.spaces.create(
  caller,
  { key: 'TEC', name: 'Delivery Board', description: 'Execução pela Tecnologia', type: 'software' },
  LETS_WORKFLOWS.TEC
)

// ADR-0012: everyone reads every space; roles to edit come through groups. Ana edits through Produto
// and creates spaces; Gil edits TEC through Tecnologia; Rui only reads, and has asked to edit PRD.
const people = [
  { email: 'ana@uselets.com', name: 'Ana', jobTitle: 'Gerente de produto' },
  { email: 'gil@uselets.com', name: 'Gil', jobTitle: 'Engenheiro de software' },
  { email: 'rui@uselets.com', name: 'Rui', jobTitle: 'Analista de operações' }
] as const

const invited: Record<string, string> = {}
for (const person of people) {
  const member = await service.members.invite(caller, { ...person, isOrgAdmin: false })
  invited[person.email] = member.id
}
await service.members.setSpaceManager(caller, invited['ana@uselets.com'] ?? '', true)

const group = async (name: string, description: string, owner: string, spaceIds: string[]) => {
  const created = await service.groups.create(caller, { name, description })
  await service.groups.putMember(caller, created.id, invited[owner] ?? '', true)
  for (const spaceId of spaceIds) {
    await service.grants.putGroup(caller, 'jiraia', spaceId, created.id, 'member')
  }
  return created.id
}
const productGroup = await group('Produto', 'Time de Produto', 'ana@uselets.com', [requisicoes.id, discovery.id])
await group('Tecnologia', 'Time de Tecnologia', 'gil@uselets.com', [delivery.id])

// Whoever runs the project locally signs in as themselves and is an organization admin, so the
// controls only admins see (creating spaces) are there without switching to admin@uselets.com.
// `LOCAL_ADMIN_EMAIL` (in the git-ignored `.env`) names them; failing that, `git config user.email`
// when it is a corporate address. A personal address is skipped: it could never sign in.
const gitEmail = Bun.spawnSync(['git', 'config', 'user.email']).stdout.toString()
const runner = (process.env.LOCAL_ADMIN_EMAIL ?? gitEmail).trim().toLowerCase()
if (runner.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`) && runner !== admin.email) {
  await service.members.invite(caller, {
    email: runner,
    name: runner.split('@')[0] ?? runner,
    jobTitle: null,
    isOrgAdmin: true
  })
}

/** Example opportunities across the Discovery Board, so the board has something to move on day one. */
const OPPORTUNITIES: [title: string, state: string, priority: Priority, labels: string[], assignee?: string][] = [
  ['Rastreio em tempo real no app do lojista', 'Backlog', 'medium', ['okr-expansao-base']],
  ['Cotação de frete por região de entrega', 'Backlog', 'low', ['okr-novos-clientes']],
  ['Cobrança automática de frete por região', 'Priorizado', 'high', ['okr-saude-escala'], 'ana@uselets.com'],
  ['Painel de SLA por transportadora', 'Especificação', 'high', ['okr-saude-escala'], 'ana@uselets.com'],
  ['Novo fluxo de cancelamento de pedido', 'Em UX/UI', 'medium', ['okr-expansao-base']],
  ['Alertas de atraso por WhatsApp', 'Em validação', 'highest', ['okr-novos-clientes'], 'ana@uselets.com'],
  ['Relatório semanal de entregas por loja', 'Em refinamento', 'medium', ['okr-expansao-base']],
  ['Agendamento de coleta pelo painel', 'Em Delivery', 'high', ['okr-saude-escala']],
  ['Cotação simultânea de transportadoras', 'Lançado', 'high', ['okr-novos-clientes']],
  ['Emissão automática de nota de frete', 'Bloqueado', 'highest', ['okr-saude-escala']]
]

const workflow = await service.workflows.get(caller, discovery.id)
const stateId = (name: string) => workflow.states.find((state) => state.name === name)?.id
for (const [title, state, priority, labels, assignee] of OPPORTUNITIES) {
  // A card reaches Lançado by moving there, as in real life — so "Lançados nos últimos 7 dias" finds it.
  const launched = state === 'Lançado'
  const created = await service.cards.create(caller, discovery.id, {
    title,
    description: '',
    priority,
    labels,
    ...(stateId(launched ? 'Preparando para lançar' : state)
      ? { stateId: stateId(launched ? 'Preparando para lançar' : state) }
      : {}),
    ...(assignee ? { assigneeId: invited[assignee] ?? null } : {})
  })
  if (launched) {
    await service.cards.move(caller, created.id, { stateId: stateId('Lançado') ?? '', index: 0 })
  }
}

const req = await service.workflows.get(caller, requisicoes.id)
for (const [title, state] of [
  ['Relatório de pedidos atrasados para o CS', '🧞‍♂️ Itens solicitados'],
  ['Exportar faturas em lote', '🧞‍♂️ Itens solicitados'],
  ['Alertas de atraso por WhatsApp', '🚨 Itens priorizados']
] as const) {
  const target = req.states.find((each) => each.name === state)?.id
  await service.cards.create(caller, requisicoes.id, {
    title,
    description: '',
    priority: 'medium',
    labels: ['business-form'],
    ...(target ? { stateId: target } : {})
  })
}

// The JQLs of `backlog/fluxo-jira.md`, as the spaces' saved views (escopo-mvp 3.5).
const reqState = (name: string) => req.states.find((state) => state.name === name)?.id ?? ''
const prdStates = (...names: string[]) => names.map((name) => stateId(name) ?? '')
const oportunidade = workflow.types.find((type) => type.name === 'Oportunidade')?.id ?? ''
const SAVED_VIEWS: { name: string; spaceId: string; filter: CardFilter; order?: CardOrder }[] = [
  {
    name: 'REQ aguardando triagem',
    spaceId: requisicoes.id,
    filter: { spaceIds: [requisicoes.id], stateIds: [reqState('🧞‍♂️ Itens solicitados')] },
    order: { by: 'created', descending: false }
  },
  {
    name: 'Discovery em andamento',
    spaceId: discovery.id,
    filter: {
      spaceIds: [discovery.id],
      typeIds: [oportunidade],
      stateIds: prdStates('Priorizado', 'Especificação', 'Em UX/UI', 'Em validação')
    }
  },
  { name: 'Bloqueados', spaceId: discovery.id, filter: { spaceIds: [discovery.id], stateIds: prdStates('Bloqueado') } },
  {
    name: 'Lançados nos últimos 7 dias',
    spaceId: discovery.id,
    filter: {
      spaceIds: [discovery.id],
      stateIds: prdStates('Lançado'),
      movedTo: { stateIds: prdStates('Lançado'), after: '-7d' }
    }
  },
  {
    name: 'Por KR: okr-saude-escala',
    spaceId: discovery.id,
    filter: { spaceIds: [requisicoes.id, discovery.id], labelsAny: ['okr-saude-escala'] },
    order: { by: 'key', descending: false }
  }
]
for (const view of SAVED_VIEWS) {
  await service.views.create(caller, {
    scope: 'space',
    layout: 'list',
    lanes: 'none',
    columns: [],
    order: { by: 'rank', descending: false },
    ...view
  })
}

// LET’S Draw AI (ADR-0011): Produto's space, laid out as its Confluence space is, with the two pages
// fluxo-jira.md cites in "01. Processos".
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const heading = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const PAGES = [
  {
    title: 'Esteira de produto',
    blocks: [
      paragraph('Do insight ao lançamento: como uma oportunidade anda pelo Discovery Board.'),
      heading('Discovery'),
      paragraph('Backlog → Priorizado → Especificação → Em UX/UI → Em validação.'),
      heading('Delivery'),
      paragraph('Em refinamento → Em Delivery (no TEC) → Preparando para lançar → Lançado.'),
      { type: 'cardEmbed', attrs: { key: 'PRD-1', title: 'Rastreio em tempo real no app do lojista' } }
    ]
  },
  {
    title: 'Requisições para Produto',
    blocks: [
      paragraph('As áreas abrem requisições pelo formulário do REQ; Produto faz a triagem toda semana.'),
      heading('Status'),
      paragraph('🧞‍♂️ Itens solicitados, 🚨 Itens priorizados, Itens despriorizados, 🚀 Itens concluídos.')
    ]
  }
]
const produto = await service.drawSpaces.create(caller, {
  name: 'Produto',
  description: 'Processos, specs e atas de Produto',
  icon: '🧭'
})
await service.grants.putGroup(caller, 'draw', produto.id, productGroup, 'member')
await service.accessRequests.create(callerFromClaims(localClaims('rui@uselets.com')), {
  product: 'jiraia',
  spaceId: discovery.id,
  message: 'Sou de CS e quero registrar oportunidades dos lojistas.'
})
const folder = async (title: string, parentId?: string) =>
  (await service.contents.create(caller, produto.id, { kind: 'folder', title, ...(parentId ? { parentId } : {}) })).id
await folder('01. Antigo')
const novo = await folder('02. Novo')
const processos = await folder('01. Processos', novo)
for (const title of ['02. Discovery', '03. Delivery', '04. Meetings']) {
  await folder(title, novo)
}
for (const { title, blocks } of PAGES) {
  const text = blocks.map((block) => ('content' in block ? block.content[0]?.text : block.attrs.key)).join('\n')
  await service.contents.create(caller, produto.id, {
    kind: 'page',
    title,
    parentId: processos,
    draft: { json: { type: 'doc', content: blocks }, text }
  })
}

await seedIntake(service, caller, { req: requisicoes.id, prd: discovery.id, tec: delivery.id })
// The seed is the past, not news: nothing it wrote should reach the automations when the API starts.
await db.update(auditEvents).set({ dispatchedAt: new Date() })

console.error(
  `  seed: REQ, PRD (Discovery Board) and TEC with cards and saved views; the REQ form and the REQ → PRD and TEC → PRD rules; LET’S Draw AI's Produto space; groups Produto and Tecnologia; admin, ana (space manager), gil, rui (asked to edit PRD)${runner ? ` and ${runner} (admin)` : ''}`
)
process.exit(0)
