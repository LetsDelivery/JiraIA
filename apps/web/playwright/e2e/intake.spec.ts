import { type Browser, expect, type Page, test } from '@playwright/test'

/**
 * Etapa 5a through the screens (escopo-mvp 4.1–4.5): someone who only reads Requisições sends the
 * REQ form; Produto prioritizes the request, and the seeded rule opens the Opportunity in the
 * Discovery Board — its run shows on the Automações tab. Slack is printed by the harness.
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

/** Each person in their own browser context, so two can be signed in during one test. */
const person = async (browser: Browser, email: string) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, email)
  return page
}

test('a reader sends the REQ form; prioritizing it opens the Opportunity in PRD', async ({ browser }) => {
  const page = await person(browser, 'rui@uselets.com')
  await page.goto('/espacos/REQ?aba=formularios')
  await page.getByRole('link', { name: 'Abrir' }).click()
  await expect(page.getByRole('heading', { name: 'Pedido para Produto' })).toBeVisible()

  await page.getByLabel('O que você precisa?').fill('Mapa de entregas por região')
  await page.getByRole('combobox', { name: 'De qual área você é?' }).click()
  await page.getByRole('option', { name: 'Operações' }).click()
  await page.getByLabel('Qual é o problema hoje?').fill('Operações não vê onde as entregas atrasam.')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByText('Pedido enviado')).toBeVisible()
  const key = (await page.locator('.form-page-done .key').textContent()) ?? ''

  const admin = await person(browser, 'admin@uselets.com')
  await admin.goto(`/espacos/REQ?card=${key}`)
  const detail = admin.getByRole('dialog', { name: new RegExp(`^${key} `) })
  await detail.getByRole('combobox', { name: 'Estado' }).click()
  await detail.getByRole('option', { name: '🚨 Itens priorizados' }).click()
  await expect(detail.getByRole('combobox', { name: 'Estado' })).toContainText('Itens priorizados')
  await detail.getByRole('button', { name: 'Fechar' }).click()

  await expect(async () => {
    await admin.goto('/espacos/PRD?aba=lista')
    await expect(admin.getByRole('table')).toContainText('Mapa de entregas por região')
  }).toPass({ timeout: 10_000 })

  await admin.goto('/espacos/REQ?aba=automacoes')
  const rule = admin.locator('.intake-card').filter({ hasText: 'Requisição priorizada vira Oportunidade no PRD' })
  await rule.getByRole('button', { name: 'Execuções' }).click()
  await expect(rule.locator('.run').first()).toContainText('Executou')
  await expect(rule.locator('.run').first()).toContainText('Publicou no Slack')
})

test('an admin writes an automation with the editor, and it reads back as a sentence', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/TEC?aba=automacoes')
  await page.getByRole('button', { name: 'Nova automação' }).click()
  const editor = page.getByRole('dialog', { name: 'Nova automação' })
  await editor.getByLabel('Nome').fill('Bug aberto avisa no card')
  await editor.getByRole('combobox', { name: 'Acontece' }).click()
  await editor.getByRole('option', { name: 'Um card é criado' }).click()
  await editor.getByLabel('Comentário').fill('Triagem em até um dia útil.')
  await editor.getByRole('button', { name: 'Criar automação' }).click()

  const rule = page.locator('.intake-card').filter({ hasText: 'Bug aberto avisa no card' })
  await expect(rule).toContainText('Quando um card é criado')
  await expect(rule).toContainText('Comenta no card')
})

test('the integrations list the channels without their webhooks', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/integracoes')
  await expect(page.getByRole('table')).toContainText('#product_updates')
  await expect(page.getByRole('table')).toContainText('hooks.slack.com/…seed')
  await expect(page.getByRole('table')).not.toContainText('LOCAL/EXAMPLE')
})
