import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 5b through the screens (escopo-mvp 4.6): Ana mentions Gil in a comment; Gil sees it on the
 * bell, opens it — the card opens and the notice is read — archives it and chooses what reaches him
 * by e-mail.
 */
const API = 'http://localhost:8290/work'

const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const as = (email: string) => ({ headers: { 'x-local-user': email } })

test('a mention reaches the bell, opens the card, and is archived', async ({ page }) => {
  const gil = (await (await page.request.get(`${API}/me`, as('gil@uselets.com'))).json()) as { id: string }
  const card = (await (await page.request.get(`${API}/cards/by-key/PRD-5`, as('ana@uselets.com'))).json()) as {
    id: string
  }
  await page.request.post(`${API}/cards/${card.id}/comments`, {
    ...as('ana@uselets.com'),
    data: { body: `<@${gil.id}> consegue estimar o esforço?` }
  })

  await signIn(page, 'gil@uselets.com')
  await expect(page.getByRole('link', { name: /Notificações, \d+ não lidas/ })).toBeVisible()
  await page.getByRole('link', { name: /Notificações/ }).click()
  const notice = page.locator('.notice').filter({ hasText: 'mencionou você em PRD-5' })
  await expect(notice).toContainText('consegue estimar o esforço?')

  await notice.getByRole('link', { name: /mencionou você em PRD-5/ }).click()
  await expect(page.getByRole('dialog', { name: /^PRD-5 / })).toBeVisible()
  await page
    .getByRole('dialog', { name: /^PRD-5 / })
    .getByRole('button', { name: 'Fechar' })
    .click()

  await page.goto('/notificacoes')
  await expect(notice).not.toHaveClass(/is-unread/)
  await notice.hover()
  await notice.getByRole('button', { name: 'Arquivar' }).click()
  await expect(notice).toHaveCount(0)
  await page.getByRole('link', { name: 'Arquivadas' }).click()
  await expect(page.locator('.notice').filter({ hasText: 'mencionou você em PRD-5' })).toBeVisible()
})

test('a person chooses what reaches them by e-mail', async ({ page }) => {
  await signIn(page, 'ana@uselets.com')
  await page.goto('/notificacoes?aba=preferencias')
  await page.getByRole('combobox', { name: 'Como avisar: Comentários' }).click()
  await page.getByRole('option', { name: 'JiraIA e e-mail diário' }).click()
  await expect(page.getByText('Preferência salva.')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Como avisar: Comentários' })).toContainText('JiraIA e e-mail diário')
})
