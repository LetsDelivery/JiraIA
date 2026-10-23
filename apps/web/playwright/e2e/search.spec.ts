import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 3: filters on the board, list and backlog (3.4), saved views — the seed holds the JQLs of
 * `backlog/fluxo-jira.md` as the spaces' views (3.5) — search and keys from the top bar (3.6), and
 * changing many cards at once (3.8).
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

const chooseView = async (page: Page, name: string) => {
  await page.getByRole('combobox', { name: 'Visão salva' }).click()
  await page.getByRole('option', { name, exact: true }).click()
}

test('a filter narrows the board, lives in the address and is saved as a personal view', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/PRD')
  await page.getByText('Filtros').click()
  await page.getByRole('group', { name: 'Prioridade' }).getByRole('button', { name: 'Altíssima' }).click()

  await expect(page).toHaveURL(/filtro=/)
  await expect(column(page, 'Em validação')).toContainText('Alertas de atraso por WhatsApp')
  await expect(column(page, 'Bloqueado')).toContainText('Emissão automática de nota de frete')
  await expect(page.locator('.card-tile')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.card-tile')).toHaveCount(2)

  await page.getByRole('button', { name: 'Salvar visão' }).click()
  const dialog = page.getByRole('dialog', { name: 'Salvar visão' })
  await dialog.getByLabel('Nome').fill('Urgentes')
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  await expect(page).toHaveURL(/visao=/)
  await expect(page).not.toHaveURL(/filtro=/)
  await expect(page.locator('.card-tile')).toHaveCount(2)

  await expect(page.getByRole('button', { name: 'Excluir visão Urgentes' })).toBeVisible()
  await page.getByRole('button', { name: 'Limpar filtros' }).click()
  await expect(page).not.toHaveURL(/visao=/)
  await expect(page.locator('.card-tile')).not.toHaveCount(2)
})

test('the seeded views answer the JQLs: Bloqueados and Lançados nos últimos 7 dias', async ({ page }) => {
  await signIn(page, 'ana@uselets.com')
  await page.goto('/espacos/PRD')
  await chooseView(page, 'Bloqueados')
  await expect(page).toHaveURL(/aba=lista/)
  const rows = page.getByRole('table').locator('tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Emissão automática de nota de frete')

  await chooseView(page, 'Lançados nos últimos 7 dias')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Cotação simultânea de transportadoras')
  await expect(page.getByRole('button', { name: /Excluir visão/ })).toHaveCount(0)
})

test('the top bar searches text across spaces and goes straight to a typed key', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  const api = { headers: { 'x-local-user': 'admin@uselets.com' } }
  const card = (await (await page.request.get('http://localhost:8290/work/cards/by-key/PRD-2', api)).json()) as {
    id: string
  }
  await page.request.post(`http://localhost:8290/work/cards/${card.id}/comments`, {
    ...api,
    data: { body: 'Precisa de um parecer do jurídico sobre o frete' }
  })
  const box = page.getByRole('combobox', { name: 'Buscar cards ou ir para uma chave' })
  await box.fill('parecer do jurídico')
  await box.press('Enter')
  await expect(page).toHaveURL(/\/busca\?q=/)
  const results = page.locator('.search-result')
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('PRD-2')
  await expect(results.first()).toContainText('num comentário')

  await page.keyboard.press('/')
  await expect(box).toBeFocused()
  await box.fill('prd-4')
  await box.press('Enter')
  await expect(page).toHaveURL(/\/espacos\/PRD\?card=PRD-4/)
  await expect(page.getByRole('dialog', { name: /^PRD-4 / })).toBeVisible()
})

test('the search box suggests cards by title as one types, and a suggestion opens its card', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  const api = { headers: { 'x-local-user': 'admin@uselets.com' } }
  const card = (await (await page.request.get('http://localhost:8290/work/cards/by-key/PRD-4', api)).json()) as {
    title: string
  }
  const box = page.getByRole('combobox', { name: 'Buscar cards ou ir para uma chave' })
  await box.fill(card.title.slice(0, 12))
  await page.getByRole('option', { name: new RegExp(`PRD-4 `) }).click()
  await expect(page).toHaveURL(/\/espacos\/PRD\?card=PRD-4/)
  await expect(page.getByRole('dialog', { name: /^PRD-4 / })).toBeVisible()
})

test('a saved view across spaces runs from the search screen', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/busca')
  await page.getByRole('link', { name: 'Por KR: okr-saude-escala' }).click()
  await expect(page.getByRole('heading', { name: 'Por KR: okr-saude-escala' })).toBeVisible()
  await expect(page.locator('.search-result')).toHaveCount(4)
})

test('the list changes many cards at once: a state and labels', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/REQ?aba=lista')
  await page.getByLabel('Selecionar REQ-1').check()
  await page.getByLabel('Selecionar REQ-2').check()
  const bar = page.getByRole('region', { name: 'Ações em massa' })
  await expect(bar).toContainText('2 selecionados')

  await bar.getByRole('combobox', { name: 'Mover para' }).click()
  await bar.getByRole('option', { name: '🚨 Itens priorizados' }).click()
  await expect(page.getByText('2 cards alterados.')).toBeVisible()
  await bar.getByLabel('Adicionar labels').fill('okr-nenhum')
  await bar.getByRole('button', { name: 'Adicionar labels' }).click()

  await expect(page.getByText('2 cards alterados.')).toHaveCount(2)

  const row = (key: string) => page.getByRole('table').locator('tbody tr').filter({ hasText: key })
  await expect(row('REQ-1')).toContainText('🚨 Itens priorizados')
  await expect(row('REQ-2')).toContainText('🚨 Itens priorizados')
  const labelled = await page.request.post('http://localhost:8290/work/cards/search', {
    headers: { 'x-local-user': 'admin@uselets.com' },
    data: { filter: { labelsAny: ['okr-nenhum'] }, order: { by: 'key' } }
  })
  expect(((await labelled.json()) as { items: { key: string }[] }).items.map((card) => card.key)).toEqual([
    'REQ-1',
    'REQ-2'
  ])
})
