import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 3b (escopo-mvp 3.11, ADR-0029): a team plans a sprint in the backlog, works on its board and
 * closes it, carrying what is still open. A space of its own, so the other specs' cards stay out.
 */
const API = 'http://localhost:8290/work'
const AS_ADMIN = { headers: { 'x-local-user': 'admin@uselets.com' } }

const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

/** A software space with three cards, in points — through the API, as a team that already exists. */
const seedSpace = async (page: Page) => {
  const created = await page.request.post(`${API}/spaces`, {
    ...AS_ADMIN,
    data: { key: 'SPR', name: 'Squad Rotas', type: 'software' }
  })
  const space = (await created.json()) as { id: string }
  await page.request.patch(`${API}/spaces/${space.id}`, { ...AS_ADMIN, data: { estimation: 'points' } })
  for (const title of ['Roteirizar coletas', 'Janela de entrega', 'Mapa de calor']) {
    await page.request.post(`${API}/spaces/${space.id}/cards`, { ...AS_ADMIN, data: { title } })
  }
}

test('a sprint is planned in the backlog, started, worked on its board and closed', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await seedSpace(page)

  await page.goto('/espacos/SPR?aba=backlog')
  await page.getByRole('button', { name: 'Criar sprint' }).click()
  await page.getByRole('dialog', { name: 'Criar sprint' }).getByRole('button', { name: 'Criar sprint' }).click()
  const sprint = page.getByRole('region', { name: 'Sprint 1' })
  await expect(sprint.getByText('Planejada')).toBeVisible()

  await page.locator('.backlog-row', { hasText: 'Roteirizar coletas' }).dragTo(sprint.locator('[data-drop-sprint]'))
  await expect(sprint.getByText('Roteirizar coletas')).toBeVisible()
  await expect(sprint.getByText('1 card · 0 pontos')).toBeVisible()

  await sprint.getByRole('button', { name: 'Iniciar sprint' }).click()
  await page.getByRole('dialog', { name: 'Iniciar Sprint 1' }).getByRole('button', { name: 'Iniciar sprint' }).click()
  await expect(sprint.getByText('Ativa')).toBeVisible()

  await page.goto('/espacos/SPR?aba=relatorios')
  const burndown = page.locator('.widget', { hasText: 'Burndown da sprint' })
  await expect(burndown).toContainText('Sprint 1')
  await expect(burndown.locator('.chart-ideal')).toHaveCount(1)
  await expect(page.locator('.widget', { hasText: 'Velocidade' })).toContainText('Nenhuma sprint encerrada ainda.')

  await page.goto('/espacos/SPR')
  await expect(page.locator('.sprint-strip')).toContainText('Sprint 1')
  await expect(page.locator('.card-tile')).toHaveCount(1)

  await page.getByRole('button', { name: 'Encerrar sprint' }).click()
  const closing = page.getByRole('dialog', { name: 'Encerrar Sprint 1' })
  await expect(closing).toContainText('0 cards concluídos e 1 aberto')
  await closing.getByRole('button', { name: 'Encerrar sprint' }).click()

  await page.goto('/espacos/SPR?aba=backlog')
  const next = page.getByRole('region', { name: 'Sprint 2' })
  await expect(next.getByText('Roteirizar coletas')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Sprint 1' })).toHaveCount(0)
})

test('a card takes its sprint and its points in the card itself', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/SPR?card=SPR-2')
  const detail = page.getByRole('dialog', { name: /^SPR-2 / })
  await detail.getByRole('combobox', { name: 'Pontos' }).click()
  await detail.getByRole('option', { name: '5', exact: true }).click()
  await detail.getByRole('combobox', { name: 'Sprint' }).click()
  await detail.getByRole('option', { name: 'Sprint 2' }).click()
  await detail.getByRole('tab', { name: 'Tudo' }).click()
  await expect(detail.getByText('Sprint: — → Sprint 2')).toBeVisible()
  await expect(detail.getByText('Pontos: — → 5')).toBeVisible()
})
