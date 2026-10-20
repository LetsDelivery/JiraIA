import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 5c through the screens (escopo-mvp 4.7, 4.8): a personal API token whose value is shown once
 * and works on /v1; a webhook whose secret is shown once and whose deliveries list what was sent;
 * a service account an admin creates. The harness prints webhooks and answers 200.
 */
const API = 'http://localhost:8290/work'

const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

test('a personal token is shown once, works on /v1 and stops when revoked', async ({ page }) => {
  await signIn(page, 'ana@uselets.com')
  await page.getByRole('button', { name: /^Sua conta/ }).click()
  await page.getByRole('menuitem', { name: 'Perfil' }).click()
  await page.getByRole('button', { name: 'Novo token' }).click()
  const form = page.getByRole('dialog', { name: 'Novo token de API' })
  await form.getByLabel('Para que serve').fill('Planilha de roadmap')
  await form.getByRole('button', { name: 'Criar token' }).click()

  const value = (await page.locator('[data-secret]').textContent()) ?? ''
  expect(value).toMatch(/^jia_/)
  const me = await page.request.get(`${API}/v1/me`, { headers: { authorization: `Bearer ${value}` } })
  expect(((await me.json()) as { email: string }).email).toBe('ana@uselets.com')

  await page.getByRole('dialog', { name: 'Seu token' }).getByRole('button', { name: 'Fechar' }).click()
  await expect(page.getByRole('table')).not.toContainText(value)
  await page.getByRole('button', { name: 'Revogar' }).click()
  await expect(page.getByRole('table')).toContainText('Revogado')
  expect((await page.request.get(`${API}/v1/me`, { headers: { authorization: `Bearer ${value}` } })).status()).toBe(401)
})

test('an admin adds a webhook, sees its secret once, and its deliveries', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/PRD?aba=webhooks')
  await page.getByRole('button', { name: 'Novo webhook' }).click()
  const editor = page.getByRole('dialog', { name: 'Novo webhook' })
  await editor.getByLabel('Nome').fill('ERP')
  await editor.getByLabel('Endereço (https)').fill('https://erp.example.com/jiraia')
  await editor.getByRole('button', { name: 'Comentário' }).click()
  await editor.getByRole('button', { name: 'Criar webhook' }).click()
  await expect(page.locator('[data-secret]')).toContainText('whsec_')
  await page.getByRole('dialog', { name: 'Segredo do webhook' }).getByRole('button', { name: 'Fechar' }).click()

  const card = (await (
    await page.request.get(`${API}/cards/by-key/PRD-6`, { headers: { 'x-local-user': 'admin@uselets.com' } })
  ).json()) as { id: string }
  await page.request.post(`${API}/cards/${card.id}/comments`, {
    headers: { 'x-local-user': 'admin@uselets.com' },
    data: { body: 'Vai para o ERP' }
  })

  const hook = page.locator('.intake-card').filter({ hasText: 'ERP' })
  await expect(async () => {
    await hook.getByRole('button', { name: 'Entregas' }).click()
    await expect(hook.locator('.run').first()).toContainText('Entregue', { timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
})

test('the webhooks tab is for the space admins only', async ({ page }) => {
  await signIn(page, 'rui@uselets.com')
  await page.goto('/espacos/PRD')
  await expect(page.getByRole('link', { name: 'Webhooks' })).toHaveCount(0)
})

test('an admin creates a service account, ready to receive roles', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/integracoes')
  await page.getByRole('button', { name: 'Nova conta de serviço' }).click()
  await page.getByRole('dialog', { name: 'Nova conta de serviço' }).getByLabel('Nome').fill('Rotina de roadmap')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page.locator('[data-service-accounts]')).toContainText('Rotina de roadmap')
})
