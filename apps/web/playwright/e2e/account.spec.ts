import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 5e through the screens (ADR-0018): the account menu at the right of the header, the account
 * settings, and connecting Slack. The E2E stack runs the local Slack stand-in, so the consent screen is
 * the only step that would leave the machine: the test answers it as Slack would.
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const openAccount = async (page: Page) => await page.getByRole('button', { name: /^Sua conta/ }).click()

test('the account menu shows who is signed in, changes the theme and opens the settings', async ({ page }) => {
  await signIn(page, 'ana@uselets.com')
  await openAccount(page)
  const menu = page.getByRole('menu', { name: 'Sua conta' })
  await expect(menu).toContainText('ana@uselets.com')
  await page.screenshot({ path: test.info().outputPath('menu.png') })
  await menu.getByRole('menuitemradio', { name: 'Escuro' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: test.info().outputPath('dark.png') })

  await openAccount(page)
  await page.getByRole('menuitem', { name: 'Configurações da conta' }).click()
  await expect(page.getByRole('heading', { name: 'Configurações da conta' })).toBeVisible()
  await page.getByRole('radio', { name: 'Seguir o sistema' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)
  await expect(page.getByText('O Slack ainda não está conectado à organização.')).toBeVisible()
})

test('an admin connects Slack; a person is found there and routes a notice to it', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await openAccount(page)
  await page.getByRole('menuitem', { name: 'Slack' }).click()
  await expect(page.getByRole('heading', { name: 'Integração com o Slack' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('slack-before.png'), fullPage: true })

  // Slack's consent screen, answered as Slack would: back to the panel with a code and the same state.
  await page.route('https://slack.com/oauth/v2/authorize**', async (route) => {
    const asked = new URL(route.request().url())
    const back = new URL(asked.searchParams.get('redirect_uri') ?? '')
    back.searchParams.set('code', 'local-code')
    back.searchParams.set('state', asked.searchParams.get('state') ?? '')
    await route.fulfill({ status: 302, headers: { location: back.toString() } })
  })
  await page.getByRole('button', { name: 'Conectar a um workspace do Slack' }).click()
  await expect(page.getByText('Conectado ao workspace LET’S (local)')).toBeVisible()
  await expect(page.getByText('Achamos você no Slack pelo seu e-mail.')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('slack-after.png'), fullPage: true })

  await page.goto('/configuracoes')
  await page.getByRole('combobox', { name: 'Como avisar: Atribuições' }).click()
  await page.getByRole('option', { name: 'JiraIA e Slack' }).click()
  await expect(page.locator('.toast', { hasText: 'Preferência salva.' })).toBeVisible()

  await page.goto('/slack')
  await page.getByRole('button', { name: 'Desconectar' }).click()
  await page.getByRole('dialog', { name: 'Desconectar o Slack' }).getByRole('button', { name: 'Desconectar' }).click()
  await expect(page.getByRole('button', { name: 'Conectar a um workspace do Slack' })).toBeVisible()
})

test('someone who is not an admin is told who connects Slack', async ({ page }) => {
  await signIn(page, 'rui@uselets.com')
  await page.goto('/slack')
  await expect(page.getByText('Um administrador da organização conecta aqui.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Conectar a um workspace do Slack' })).toHaveCount(0)
})
