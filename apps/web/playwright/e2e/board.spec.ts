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

  await page.getByRole('link', { name: 'Configurações' }).click()
  await page.getByRole('navigation', { name: 'Seções das configurações' }).getByRole('link', { name: 'Fluxo' }).click()
  await page.getByLabel('Novo estado', { exact: true }).fill('🚧 Em pausa')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByLabel('Nome do estado').last()).toHaveValue('🚧 Em pausa')
  await page.getByRole('link', { name: 'Discovery Board' }).first().click()
  await expect(column(page, '🚧 Em pausa')).toBeVisible()
})

test('a tile changes priority, assignee, labels and due date without opening the card', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/REQ')
  const add = page.getByPlaceholder('+ Criar card').first()
  await add.fill('Ajustar pelo tile')
  await add.press('Enter')
  const tile = page.locator('.card-tile', { hasText: 'Ajustar pelo tile' })
  await expect(tile).toBeVisible()

  await tile.getByRole('button', { name: /^Prioridade:/ }).click()
  await page.getByRole('option', { name: 'Alta', exact: true }).click()
  await expect(tile.getByRole('button', { name: 'Prioridade: Alta' })).toBeVisible()

  await tile.getByRole('button', { name: /^Responsável:/ }).click()
  await page.getByRole('listbox', { name: 'Responsável' }).getByRole('option', { name: 'Ana' }).click()
  await expect(tile.getByRole('button', { name: 'Responsável: Ana' })).toBeVisible()

  await tile.getByRole('button', { name: /^Labels:/ }).click()
  await page.getByRole('textbox', { name: 'Labels' }).fill('via-tile')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(tile.getByRole('button', { name: 'Labels: via-tile' })).toBeVisible()

  await tile.getByRole('button', { name: /^Data limite:/ }).click()
  await page.getByRole('dialog', { name: 'Escolher data' }).getByRole('button', { name: 'Hoje' }).click()
  await expect(tile.getByRole('button', { name: /^Data limite: \d\d\/\d\d\/\d{4}$/ })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /Ajustar pelo tile/ })).toBeHidden()
})

test('a reader sees the board but cannot drag, add or configure', async ({ page }) => {
  await signIn(page, 'rui@uselets.com')
  await page.getByRole('group', { name: 'Todos os espaços' }).getByRole('link', { name: 'Discovery Board' }).click()

  await expect(column(page, 'Backlog')).toBeVisible()
  await expect(page.locator('.card-tile[draggable="true"]')).toHaveCount(0)
  await expect(page.getByLabel('Novo card em Backlog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Criar card' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Configurações' }).click()
  await page.getByRole('link', { name: 'Fluxo' }).click()
  await expect(page.getByLabel('Novo estado', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('list').getByText('Backlog')).toBeVisible()
})

test('every tab of a space takes the whole width of a wide screen', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.setViewportSize({ width: 1720, height: 1000 })
  for (const tab of ['board', 'lista', 'backlog', 'relatorios']) {
    await page.goto(`/espacos/PRD?aba=${tab}`)
    const tabs = await page.locator('.space-tabs').boundingBox()
    expect(tabs?.width ?? 0, `aba ${tab}`).toBeGreaterThan(1300)
    await page.screenshot({ path: test.info().outputPath(`${tab}.png`) })
  }
})

test('the space settings add a card type with its look, restyle it and remove it moving its cards', async ({
  page
}) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/PRD?aba=automacoes')
  await expect(page).toHaveURL(/\/espacos\/PRD\/configuracoes\/automacoes$/)

  await page.getByRole('link', { name: 'Tipos de card' }).click()
  const types = page.getByRole('region', { name: 'Tipos de card' })
  await types.getByLabel('Novo tipo').fill('Spike')
  await types.getByRole('button', { name: 'Adicionar' }).click()
  await expect(types.getByLabel('Nome do tipo').last()).toHaveValue('Spike')

  await types.getByRole('button', { name: 'Ícone e cor de Spike' }).click()
  await page.getByRole('dialog', { name: 'Ícone e cor de Spike' }).getByRole('button', { name: 'Violeta' }).click()
  await expect(types.locator('[data-type-id]').last().locator('.type-icon')).toHaveClass(/type-violet/)

  await types.getByRole('button', { name: 'Excluir Spike' }).click()
  await page.getByRole('option', { name: 'Oportunidade' }).click()
  await expect(types.getByRole('button', { name: 'Excluir Spike' })).toHaveCount(0)
})
