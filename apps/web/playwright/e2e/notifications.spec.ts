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

test('a person chooses, for each kind, any of JiraIA, e-mail and Slack', async ({ page }) => {
  await signIn(page, 'ana@uselets.com')
  await page.goto('/notificacoes')
  await expect(page.getByRole('heading', { name: 'Central de Notificações' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Notificações' }).getByRole('link')).toHaveText([
    'Caixa de entrada',
    'Adiadas',
    'Arquivadas'
  ])
  await page.getByRole('link', { name: 'Preferências' }).click()
  await expect(page.getByRole('heading', { name: 'Preferências de notificação' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Notificações' })).toHaveCount(0)
  const comments = page.getByRole('button', { name: 'Como avisar: Comentários' })
  await expect(comments).toHaveText('JiraIA e E-mail')
  await comments.click()
  const boxes = page.getByRole('group', { name: 'Como avisar: Comentários' })
  await boxes.getByRole('checkbox', { name: /^Slack/ }).check()
  await expect(page.locator('.toast', { hasText: 'Preferência salva.' }).first()).toBeVisible()
  await expect(comments).toHaveText('JiraIA, E-mail e Slack')
  await boxes.getByRole('checkbox', { name: /^E-mail/ }).uncheck()
  await expect(comments).toHaveText('JiraIA e Slack')
  await page.keyboard.press('Escape')

  const mentions = page.getByRole('button', { name: 'Como avisar: Menções', exact: true })
  await mentions.click()
  await page
    .getByRole('group', { name: 'Como avisar: Menções', exact: true })
    .getByRole('checkbox', { name: /^JiraIA/ })
    .uncheck()
  await expect(mentions).toHaveText('Não avisar')
  await page.keyboard.press('Escape')

  const weekly = page.getByRole('button', { name: 'Como avisar: Resumo semanal' })
  await weekly.scrollIntoViewIfNeeded()
  await weekly.click()
  const summary = page.getByRole('group', { name: 'Como avisar: Resumo semanal' })
  await expect(summary.getByRole('checkbox')).toHaveCount(1)
  await summary.getByRole('checkbox', { name: /^Receber por e-mail/ }).uncheck()
  await expect(weekly).toHaveText('Não receber')

  await page.reload()
  await expect(comments).toHaveText('JiraIA e Slack')
  await expect(mentions).toHaveText('Não avisar')
  await expect(weekly).toHaveText('Não receber')
})
