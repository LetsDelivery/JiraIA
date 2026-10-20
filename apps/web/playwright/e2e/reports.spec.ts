import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 5d through the screens (ADR-0016): every reader sees the space's dashboard; its admins add,
 * change, reorder and remove widgets, save them for everyone, and put the default back.
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const widget = (page: Page, title: string) =>
  page.locator('.widget').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

const choose = async (page: Page, label: string, option: string) => {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('a reader sees the default dashboard, with numbers drawn from the cards', async ({ page }) => {
  await signIn(page, 'rui@uselets.com')
  await page.goto('/espacos/PRD')
  await page.getByRole('link', { name: 'Relatórios' }).click()

  await expect(widget(page, 'Itens por estado').locator('.chart-donut')).toBeVisible()
  await expect(widget(page, 'Itens criados').locator('svg.chart-plot')).toBeVisible()
  await expect(widget(page, 'Lista de itens').getByRole('table')).toContainText('PRD-1')
  await expect(page.getByRole('button', { name: 'Editar painel' })).toHaveCount(0)
  // The dashboard takes the whole width on a wide screen, as the board does.
  await page.setViewportSize({ width: 1720, height: 1000 })
  const grid = await page.locator('.widget-grid').boundingBox()
  expect(grid?.width ?? 0).toBeGreaterThan(1300)
  await page.screenshot({ path: test.info().outputPath('dashboard.png'), fullPage: true })
})

test('an admin adds a chart, removes one, saves for everyone and restores the default', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/PRD?aba=relatorios')
  await page.getByRole('button', { name: 'Editar painel' }).click()

  await page.getByRole('button', { name: 'Adicionar widget' }).click()
  const catalog = page.getByRole('dialog', { name: 'Adicionar widget' })
  await catalog.getByLabel('Pesquisar widgets').fill('grafico')
  await catalog.getByRole('button', { name: /Gráfico/ }).click()
  const editor = page.getByRole('dialog', { name: 'Novo widget' })
  await choose(page, 'Agrupar por', 'Prioridade')
  await choose(page, 'Itens', 'Visão: Discovery em andamento')
  await editor.getByRole('button', { name: 'Adicionar' }).click()
  await widget(page, 'Lead time').getByRole('button', { name: 'Excluir Lead time' }).click()
  await page.screenshot({ path: test.info().outputPath('editing.png'), fullPage: true })
  await page.getByRole('button', { name: 'Salvar painel' }).click()

  await page.reload()
  const added = widget(page, 'Itens por prioridade')
  await expect(added.locator('.chart-bars')).toBeVisible()
  await expect(added).toContainText('Discovery em andamento')
  await expect(widget(page, 'Lead time')).toHaveCount(0)

  await page.getByRole('button', { name: 'Editar painel' }).click()
  await page.getByRole('button', { name: 'Restaurar padrão' }).click()
  await page
    .getByRole('dialog', { name: 'Restaurar o painel padrão' })
    .getByRole('button', { name: 'Restaurar padrão' })
    .click()
  await expect(widget(page, 'Lead time')).toBeVisible()
  await expect(widget(page, 'Itens por prioridade')).toHaveCount(0)
})
