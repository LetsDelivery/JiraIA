import { expect, type Page, test } from '@playwright/test'

/**
 * The Discovery Board: the real PRD workflow as columns, cards that move by drag and drop and stay
 * moved, quick add, the card detail with its fields, comments and history, and the workflow editor.
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test('the Discovery Board: columns, drag and drop, quick add, card detail and workflow', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.getByRole('group', { name: 'Todos os espaços' }).getByRole('link', { name: 'Discovery Board' }).click()
  await expect(page).toHaveURL(/\/espacos\/PRD$/)

  for (const state of [
    'Backlog',
    'Priorizado',
    'Especificação',
    'Em UX/UI',
    'Em validação',
    'Em refinamento',
    'Em Delivery',
    'Preparando para lançar',
    'Lançado',
    'Bloqueado'
  ]) {
    await expect(column(page, state)).toBeVisible()
  }

  const card = page.getByRole('listitem').filter({ hasText: 'Rastreio em tempo real no app do lojista' })
  await card.dragTo(column(page, 'Priorizado').getByRole('list'))
  await expect(column(page, 'Priorizado')).toContainText('Rastreio em tempo real no app do lojista')
  await page.reload()
  await expect(column(page, 'Priorizado')).toContainText('Rastreio em tempo real no app do lojista')

  await column(page, 'Backlog').getByLabel('Novo card em Backlog').fill('Mapa de calor de entregas')
  await column(page, 'Backlog').getByLabel('Novo card em Backlog').press('Enter')
  await expect(column(page, 'Backlog')).toContainText('Mapa de calor de entregas')
  await expect(column(page, 'Backlog')).toContainText('PRD-11')

  await column(page, 'Backlog')
    .getByRole('button', { name: /Mapa de calor de entregas/ })
    .click()
  const detail = page.getByRole('dialog', { name: /PRD-11/ })
  await expect(page).toHaveURL(/card=PRD-11/)
  await detail.getByRole('tab', { name: 'Tudo' }).click()
  await detail.getByRole('combobox', { name: 'Prioridade' }).click()
  await detail.getByRole('option', { name: 'Alta', exact: true }).click()
  await expect(detail.getByText('Prioridade: Média → Alta')).toBeVisible()
  await detail.getByRole('combobox', { name: 'Responsável' }).click()
  await detail.getByRole('option', { name: 'Ana' }).click()
  await expect(detail.getByText('Responsável: — → Ana')).toBeVisible()
  await detail.getByRole('combobox', { name: 'Estado' }).click()
  await detail.getByRole('option', { name: 'Priorizado' }).click()
  await expect(detail.getByText('Estado: Backlog → Priorizado')).toBeVisible()
  await expect(detail.getByLabel('Novo comentário')).toBeHidden()
  await detail.getByRole('tab', { name: /Comentários/ }).click()
  await detail.getByLabel('Novo comentário').fill('Vale validar com o CS.')
  await detail.getByRole('button', { name: 'Comentar' }).click()
  await expect(detail.getByText('Vale validar com o CS.')).toBeVisible()
  await expect(detail.getByText('Prioridade: Média → Alta')).toBeHidden()
  await detail.getByRole('button', { name: 'Fechar' }).click()
  await expect(page).not.toHaveURL(/card=/)

  await page.getByRole('button', { name: 'Configurar fluxo' }).click()
  const editor = page.getByRole('dialog', { name: 'Configurar fluxo' })
  await editor.getByLabel('Novo estado', { exact: true }).fill('🚧 Em pausa')
  await editor.getByRole('button', { name: 'Adicionar' }).click()
  await expect(editor.getByLabel('Nome do estado').last()).toHaveValue('🚧 Em pausa')
  await editor.getByRole('button', { name: 'Fechar' }).click()
  await expect(column(page, '🚧 Em pausa')).toBeVisible()
})

test('a reader sees the board but cannot drag, add or configure', async ({ page }) => {
  await signIn(page, 'rui@uselets.com')
  await page.getByRole('group', { name: 'Todos os espaços' }).getByRole('link', { name: 'Discovery Board' }).click()

  await expect(column(page, 'Backlog')).toBeVisible()
  await expect(page.locator('.card-tile[draggable="true"]')).toHaveCount(0)
  await expect(page.getByLabel('Novo card em Backlog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Configurar fluxo' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Criar card' })).toHaveCount(0)
})

test('every tab of a space takes the whole width of a wide screen', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.setViewportSize({ width: 1720, height: 1000 })
  for (const tab of ['board', 'lista', 'backlog', 'relatorios', 'formularios', 'automacoes', 'webhooks', 'pessoas']) {
    await page.goto(`/espacos/PRD?aba=${tab}`)
    const tabs = await page.locator('.space-tabs').boundingBox()
    expect(tabs?.width ?? 0, `aba ${tab}`).toBeGreaterThan(1300)
    await page.screenshot({ path: test.info().outputPath(`${tab}.png`) })
  }
})
