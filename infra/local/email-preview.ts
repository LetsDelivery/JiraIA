import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { accessEmail } from '../../services/work/src/notifications/email/access-emails.js'
import { mentionEmail, updatesEmail } from '../../services/work/src/notifications/email/card-emails.js'
import type { Message } from '../../services/work/src/notifications/email/kit.js'
import { drawDailyEmail, weeklyEmail } from '../../services/work/src/notifications/email/summary-emails.js'
import type { NotificationWithActor } from '../../services/work/src/notifications/notification.repository.js'
import { LOCAL_MAIL_DIR } from './config.js'

/**
 * Every e-mail template, filled with made-up data, as `.html` files to open in a browser:
 *
 *     bun run local:email-preview
 *
 * Nothing is sent and no database is read. Change a template, run it again, reload the tab.
 */
const WEB = 'http://localhost:5280'
const NOW = new Date('2026-10-23T14:17:00Z')
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * 86_400_000 - hours * 3_600_000)
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const card = (key: string, title: string, spaceName: string) => ({
  key,
  title,
  spaceName,
  url: `${WEB}/espacos/${key.split('-')[0]}?card=${key}`
})

const notice = (kind: string, actorName: string, data: Record<string, string | number>): NotificationWithActor => ({
  id: id(90),
  organizationId: id(91),
  memberId: id(92),
  kind,
  eventId: id(93),
  actorId: id(94),
  actorName,
  cardId: null,
  spaceId: null,
  data,
  createdAt: NOW,
  readAt: null,
  snoozedUntil: null,
  archivedAt: null,
  emailedAt: null
})

const mention = mentionEmail({
  readerName: 'Stênio Lima',
  card: card('REQ-29', 'Integração Wake', 'Requisições'),
  comment: {
    authorId: id(1),
    authorName: 'Bernardo Maciel',
    at: NOW,
    body: '@Stênio Lima estamos aguardando o time jurídico deles validar a minuta para evoluir com a assinatura.',
    action: 'comentou',
    url: `${WEB}/espacos/REQ?card=REQ-29`
  },
  webUrl: WEB
})

const updates = updatesEmail({
  card: card('TEC-1139', 'Trava para pedidos que estão dentro de um agrupamento | Max', 'Delivery Board'),
  updates: [
    {
      actorId: id(2),
      actorName: 'Matheus Miranda Moreira de Souza',
      at: ago(0, 2),
      changes: [
        { field: 'Responsável', before: null, after: 'Matheus Miranda Moreira de Souza' },
        { field: 'Estado', before: 'Não iniciado', after: 'Em progresso' },
        { field: 'Sprint', before: null, after: 'Sprint 17' }
      ]
    },
    {
      actorId: id(3),
      actorName: 'Ana Ribeiro',
      at: ago(0, 1),
      changes: [{ field: 'Prioridade', before: 'Média', after: 'Alta' }],
      comment: 'Subi a prioridade: o Max pediu para esta semana.'
    }
  ],
  webUrl: WEB
})

const reply = (n: number, authorName: string, key: string, space: string, body: string, days: number) => ({
  authorId: id(n),
  authorName,
  at: ago(days),
  body,
  action: `comentou em ${key}`,
  where: space,
  url: `${WEB}/espacos/${key.split('-')[0]}?card=${key}`
})

const weekly = weeklyEmail({
  readerName: 'Stênio Lima',
  now: NOW,
  mentions: [
    reply(
      4,
      'Vinícius André',
      'REQ-37',
      'Requisições',
      '@Renan Saia Gonzaga, pode fazer uma análise desse item aqui? @Stênio Lima, apoia ele por favor.',
      8
    ),
    reply(
      5,
      'Walyson Oliveira',
      'TEC-3126',
      'Delivery Board',
      'Vou ter que criar alguma forma de identificar qual a company que veio do Max ou do Gomax, @Stênio Lima.',
      24
    ),
    reply(6, 'Vinícius Furno', 'REQ-30', 'Requisições', 'Vi que já ajustou, obrigado @Stênio Lima', 27)
  ],
  mentionTotal: 5,
  open: [
    {
      ...card('TEC-3484', 'Definir regra de expiração dos comprovantes de entrega no S3', 'Delivery Board'),
      assignUrl: `${WEB}/espacos/TEC?card=TEC-3484&atribuir=eu`
    },
    {
      ...card('REQ-36', 'Dashboard comercial: agrupar clientes matrizes sob a mesma bandeira', 'Requisições'),
      assignUrl: `${WEB}/espacos/REQ?card=REQ-36&atribuir=eu`
    },
    {
      ...card('PRD-254', 'Iguatemi <> Convertize', 'Discovery Board'),
      assignUrl: `${WEB}/espacos/PRD?card=PRD-254&atribuir=eu`
    }
  ],
  openTotal: 4,
  webUrl: WEB
})

const draw = drawDailyEmail({
  readerName: 'Stênio Lima',
  now: NOW,
  changed: [
    {
      kind: 'page',
      title: 'Tecnologias Logísticas (Transportadoras)',
      spaceName: 'Produto',
      url: `${WEB}/draw/s1/c1`,
      historyUrl: `${WEB}/draw/s1/c1?painel=versoes`,
      editors: ['Gustavo Kozlowski']
    },
    {
      kind: 'board',
      title: 'Fluxo de coleta reversa',
      spaceName: 'Operações',
      url: `${WEB}/draw/s2/c2`,
      historyUrl: `${WEB}/draw/s2/c2?painel=versoes`,
      editors: ['Ana Ribeiro', 'Bruno Lopes', 'Carla Dias']
    }
  ],
  mentions: [
    {
      ...reply(7, 'Gustavo Kozlowski', '', '', '@Stênio Lima consegue revisar a seção de SLAs?', 0),
      action: 'comentou em Tecnologias Logísticas',
      where: 'Página · Produto'
    }
  ],
  webUrl: WEB
})

const access = {
  'acesso-esperando': accessEmail(
    notice('entitlement_waiting', 'Ana', {
      requestId: 'r1',
      requestKind: 'grant',
      systemName: 'AWS',
      profileName: 'Administrador',
      personName: 'Bruno Lopes'
    }),
    WEB
  ),
  'acesso-aprovado': accessEmail(
    notice('entitlement_decided', 'Ana', {
      requestId: 'r1',
      requestKind: 'grant',
      systemName: 'AWS',
      profileName: 'Leitura',
      personName: 'Stênio Lima',
      status: 'approved'
    }),
    WEB
  ),
  'acesso-atrasado': accessEmail(
    notice('entitlement_overdue', 'Ana', {
      requestId: 'r1',
      requestKind: 'removal',
      systemName: 'HubSpot',
      profileName: 'Vendas',
      personName: 'Carla Dias'
    }),
    WEB
  ),
  'revisao-aberta': accessEmail(
    notice('access_review_opened', 'Ana', { reviewId: 'v1', systemName: 'AWS', itemCount: 14 }),
    WEB
  ),
  'pedido-espaco': accessEmail(
    notice('access_requested', 'Bruno Lopes', { spaceName: 'Delivery Board', spaceKey: 'TEC' }),
    WEB
  ),
  proposta: accessEmail(
    notice('proposal_received', 'Agente de triagem', { spaceName: 'Requisições', proposalId: 'p1' }),
    WEB
  )
}

const all: Record<string, Message> = {
  mencao: mention,
  atualizacoes: updates,
  semanal: weekly,
  'draw-diario': draw,
  ...access
}
const dir = join(LOCAL_MAIL_DIR, 'preview')
await mkdir(dir, { recursive: true })
for (const [name, message] of Object.entries(all)) {
  await writeFile(join(dir, `${name}.html`), message.html)
  console.error(`  ${message.subject}\n    → ${join(dir, `${name}.html`)}`)
}
