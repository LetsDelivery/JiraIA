import { describe, expect, it } from 'bun:test'

import { accessEmail } from '../email/access-emails.js'
import { change } from '../email/blocks.js'
import { mentionEmail, names, updatesEmail } from '../email/card-emails.js'
import { ago, clock, initials, longDate, quote } from '../email/kit.js'
import { drawDailyEmail, weeklyEmail } from '../email/summary-emails.js'
import type { NotificationWithActor } from '../notification.repository.js'

const WEB = 'https://jiraia.test'
const NOW = new Date('2026-10-23T14:17:00Z')
const card = {
  key: 'REQ-29',
  title: 'Integração <b>Wake</b>',
  spaceName: 'Requisições',
  url: `${WEB}/espacos/REQ?card=REQ-29`
}
const said = (body: string, at = NOW) => ({
  authorId: '00000000-0000-4000-8000-000000000001',
  authorName: 'Bernardo Maciel',
  at,
  body,
  action: 'comentou',
  url: card.url
})

const notice = (kind: string, data: Record<string, string | number>): NotificationWithActor => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  organizationId: '00000000-0000-4000-8000-0000000000bb',
  memberId: '00000000-0000-4000-8000-0000000000cc',
  kind,
  eventId: '00000000-0000-4000-8000-0000000000dd',
  actorId: '00000000-0000-4000-8000-0000000000ee',
  actorName: 'Ana',
  cardId: null,
  spaceId: null,
  data,
  createdAt: NOW,
  readAt: null,
  snoozedUntil: null,
  archivedAt: null,
  emailedAt: null
})

describe('the e-mail kit', () => {
  it('tells the time and the day as São Paulo reads them, whatever the server zone', () => {
    expect(clock(NOW)).toBe('11:17')
    expect(longDate(new Date('2026-10-24T02:00:00Z'))).toBe('23 de outubro de 2026')
  })

  it('counts days ago in whole days', () => {
    expect(ago(NOW, NOW)).toBe('hoje')
    expect(ago(new Date(NOW.getTime() - 86_400_000), NOW)).toBe('ontem')
    expect(ago(new Date(NOW.getTime() - 8 * 86_400_000), NOW)).toBe('há 8 dias')
  })

  it('marks the reader in a quote and never lets the words write markup', () => {
    const html = quote('<i>oi</i> @Stênio Lima', 'Stênio Lima')
    expect(html).toContain('&lt;i&gt;oi&lt;/i&gt;')
    expect(html).toMatch(/<span style="[^"]+">@Stênio Lima<\/span>/)
  })

  it('names a few people and counts the rest', () => {
    expect(names(['Ana', 'Ana'])).toBe('Ana')
    expect(names(['Ana', 'Bruno'])).toBe('Ana e Bruno')
    expect(names(['Ana', 'Bruno', 'Carla', 'Davi'])).toBe('Ana, Bruno e mais 2')
    expect(initials('Matheus Miranda Moreira')).toBe('MM')
  })

  it('strikes the old value of a field and shows a first value without an arrow', () => {
    expect(change({ field: 'Estado', before: 'A fazer', after: 'Feito' })).toContain('→')
    expect(change({ field: 'Sprint', before: null, after: 'Sprint 17' })).not.toContain('→')
  })
})

describe('the card e-mails', () => {
  it('sends a mention with its words, the card and the link, escaped', () => {
    const email = mentionEmail({ readerName: 'Stênio Lima', card, comment: said('@Stênio Lima veja'), webUrl: WEB })
    expect(email.subject).toBe('Bernardo Maciel mencionou você em REQ-29')
    expect(email.html).toContain('Integração &lt;b&gt;Wake&lt;/b&gt;')
    expect(email.html).toContain(`href="${card.url}#comentar"`)
    expect(email.text).toContain(card.url)
  })

  it('counts every field and comment of the window, and who did them', () => {
    const at = NOW
    const email = updatesEmail({
      card,
      updates: [
        { actorId: 'a', actorName: 'Ana', at, changes: [{ field: 'Estado', before: 'A fazer', after: 'Feito' }] },
        { actorId: 'b', actorName: 'Bruno', at, changes: [], comment: 'feito' }
      ],
      webUrl: WEB
    })
    expect(email.subject).toBe('Ana e Bruno fizeram 2 atualizações em REQ-29')
    expect(email.text).toContain('Estado: A fazer → Feito')
  })
})

describe('the summaries', () => {
  it('says how many mentions and open cards wait, and links to the rest', () => {
    const email = weeklyEmail({
      readerName: 'Stênio Lima',
      now: NOW,
      mentions: [said('oi', new Date(NOW.getTime() - 8 * 86_400_000))],
      mentionTotal: 3,
      open: [{ ...card, assignUrl: `${card.url}&atribuir=eu` }],
      openTotal: 1,
      reviews: [],
      webUrl: WEB
    })
    expect(email.subject).toBe('Sua semana no JiraIA: 3 menções e 1 card sem responsável')
    expect(email.html).toContain('há 8 dias')
    expect(email.html).toContain('Ver todas as notificações')
    expect(email.html).not.toContain('Ver cards sem responsável')
    expect(email.html).not.toContain('Páginas da wiki para revisar')
  })

  it('lists the reader’s wiki pages to review, overdue or near, when there are some', () => {
    const page = { title: 'Loja Exemplo', collectionName: 'Clientes', url: `${WEB}/wiki/c/p` }
    const email = weeklyEmail({
      readerName: 'Stênio Lima',
      now: NOW,
      mentions: [],
      mentionTotal: 0,
      open: [],
      openTotal: 0,
      reviews: [
        { ...page, due: new Date(NOW.getTime() - 86_400_000), overdue: true },
        { ...page, title: 'Mercado Azul', due: new Date(NOW.getTime() + 5 * 86_400_000), overdue: false }
      ],
      webUrl: WEB
    })
    expect(email.subject).toBe('Sua semana no JiraIA: 0 menções e 0 cards sem responsável, 2 páginas para revisar')
    expect(email.html).toContain('Páginas da wiki para revisar (2)')
    expect(email.html).toContain('revisão vencida em')
    expect(email.html).toContain(`${WEB}/wiki/c/p`)
    expect(email.text).toContain('Mercado Azul (Clientes, até')
  })

  it('wears the LET’S Draw AI brand and names who changed each page', () => {
    const email = drawDailyEmail({
      readerName: 'Stênio Lima',
      now: NOW,
      changed: [
        {
          kind: 'page',
          title: 'SLAs',
          spaceName: 'Produto',
          url: `${WEB}/draw/s/c`,
          historyUrl: `${WEB}/draw/s/c?painel=versoes`,
          editors: ['Gustavo']
        }
      ],
      mentions: [],
      webUrl: WEB
    })
    expect(email.subject).toBe('Resumo diário do LET’S Draw AI: 1 novidade')
    expect(email.html).toContain('LET’S Draw <span')
    expect(email.html).toContain('?painel=versoes')
    expect(email.html).not.toContain('Menções em comentários')
  })
})

describe('the access e-mails', () => {
  it('lays out what waits for the owner and links to the queue', () => {
    const email = accessEmail(
      notice('entitlement_waiting', {
        requestId: 'r1',
        requestKind: 'grant',
        systemName: 'AWS',
        profileName: 'Admin',
        personName: 'Bruno'
      }),
      WEB
    )
    expect(email.subject).toBe('Pedido de acesso esperando você: AWS · Admin')
    expect(email.html).toContain(`${WEB}/acessos/fila`)
    expect(email.text).toContain('Para quem: Bruno')
  })

  it('says the outcome, and flags a request past its deadline', () => {
    const decided = { requestId: 'r1', systemName: 'AWS', profileName: 'Leitura', personName: 'Ana' }
    expect(accessEmail(notice('entitlement_decided', { ...decided, status: 'declined' }), WEB).subject).toBe(
      'Seu pedido de acesso foi recusado: AWS'
    )
    expect(accessEmail(notice('entitlement_overdue', { ...decided, requestKind: 'removal' }), WEB).html).toContain(
      'Fora do prazo'
    )
  })
})
