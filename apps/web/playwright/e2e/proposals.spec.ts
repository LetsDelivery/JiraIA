import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 6a through the screens (escopo-mvp 6.2, ADR-0019): an agent — a service account that only
 * reads — proposes through /v1; the admin sees the count on the menu, adjusts and approves, sees the
 * strip on the card, rejects another, and reverts what was applied.
 */
const API = 'http://localhost:8290/work'
const AS_ADMIN = { 'x-local-user': 'admin@uselets.com' }

const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

/** A service account and its token, made through the API as the admin. */
const agentToken = async (page: Page, name: string): Promise<string> => {
  const account = (await (
    await page.request.post(`${API}/service-accounts`, { headers: AS_ADMIN, data: { name } })
  ).json()) as { id: string }
  const token = (await (
    await page.request.post(`${API}/service-accounts/${account.id}/tokens`, { headers: AS_ADMIN, data: { name } })
  ).json()) as { value: string }
  return token.value
}

const cardByKey = async (page: Page, key: string) =>
  (await (await page.request.get(`${API}/cards/by-key/${key}`, { headers: AS_ADMIN })).json()) as {
    id: string
    spaceId: string
    title: string
  }

const propose = async (page: Page, token: string, spaceId: string, reason: string, items: unknown[]) => {
  const response = await page.request.post(`${API}/v1/spaces/${spaceId}/proposals`, {
    headers: { authorization: `Bearer ${token}` },
    data: { reason, items }
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { id: string }
}

test('an admin adjusts and approves a proposal, which lands as the agent and can be reverted', async ({ page }) => {
  const token = await agentToken(page, 'Agente de triagem')
  const card = await cardByKey(page, 'PRD-6')
  await propose(page, token, card.spaceId, 'Título mais claro para a triagem', [
    { kind: 'update_card', cardId: card.id, changes: { title: 'Título sugerido', priority: 'high' } }
  ])

  await signIn(page, 'admin@uselets.com')
  const nav = page.getByRole('link', { name: /^Propostas/ })
  await expect(nav).toContainText('1')
  await nav.click()
  const proposal = page.locator('.proposal').filter({ hasText: 'Título mais claro para a triagem' })
  await expect(proposal).toContainText('Agente de triagem')
  await expect(proposal.locator('.proposal-diff')).toContainText('Alta')

  await proposal.getByText('Ajustar antes de aprovar').click()
  await proposal.getByLabel('Título').fill('Título ajustado pela pessoa')
  await proposal.getByRole('button', { name: 'Aprovar' }).click()
  await expect(page.getByText('Proposta aplicada.')).toBeVisible()
  expect((await cardByKey(page, 'PRD-6')).title).toBe('Título ajustado pela pessoa')

  await page.getByRole('link', { name: 'Decididas' }).click()
  const decided = page.locator('.proposal').filter({ hasText: 'Título mais claro para a triagem' })
  await expect(decided).toContainText('Aplicada')
  await decided.getByRole('button', { name: 'Reverter' }).click()
  await page.getByRole('dialog', { name: 'Reverter proposta' }).getByRole('button', { name: 'Reverter' }).click()
  await expect(decided).toContainText('Revertida')
  expect((await cardByKey(page, 'PRD-6')).title).toBe(card.title)
})

test('a pending proposal shows on its card, and a rejection goes back to the agent', async ({ page }) => {
  const token = await agentToken(page, 'Agente de resumo')
  const card = await cardByKey(page, 'PRD-6')
  const { id } = await propose(page, token, card.spaceId, 'Resumo da discussão', [
    { kind: 'comment', cardId: card.id, body: 'Resumo: seguir com a opção B.' }
  ])

  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/PRD?card=PRD-6')
  const strip = page.locator('[data-proposal-strip]')
  await expect(strip).toContainText('Agente de resumo propôs mudanças neste card')
  await strip.getByRole('link', { name: 'Ver proposta' }).click()

  const proposal = page.locator(`#proposta-${id}`)
  await expect(proposal).toHaveClass(/is-focused/)
  await proposal.getByRole('button', { name: 'Recusar' }).click()
  const dialog = page.getByRole('dialog', { name: 'Recusar proposta' })
  await dialog.getByLabel('Motivo (opcional)').fill('Ainda em discussão')
  await dialog.getByRole('button', { name: 'Recusar' }).click()
  await expect(page.getByText('Proposta recusada.')).toBeVisible()

  const read = await page.request.get(`${API}/v1/proposals/${id}`, { headers: { authorization: `Bearer ${token}` } })
  expect(await read.json()).toMatchObject({ status: 'rejected', note: 'Ainda em discussão' })
})

test('a space admin lets agents comment without approval', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/PRD?aba=agentes')
  await page.getByLabel('Comentar').check()
  await expect(page.getByText('Preferência dos agentes salva.')).toBeVisible()

  const token = await agentToken(page, 'Agente de avisos')
  const card = await cardByKey(page, 'PRD-6')
  const proposal = await propose(page, token, card.spaceId, 'Aviso', [
    { kind: 'comment', cardId: card.id, body: 'Prazo confirmado.' }
  ])
  expect(proposal).toMatchObject({ status: 'applied', autoApplied: true })
})
