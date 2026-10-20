import { expect, type Page, test } from '@playwright/test'

/**
 * The panel on a phone (mobile first): the menu is a drawer, the search opens over the header, and no
 * screen is wider than the phone — a table or the board scrolls inside its frame, never the page.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const signIn = async (page: Page) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill('admin@uselets.com')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

/** Whether the page itself scrolls sideways — what a phone must never do. */
const overflowsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

test('the menu is a drawer that opens, navigates and closes', async ({ page }) => {
  await signIn(page)
  const menu = page.getByRole('navigation').filter({ hasText: 'Para você' })
  await expect(menu).not.toBeInViewport()

  await page.getByRole('button', { name: 'Mostrar ou esconder o menu' }).click()
  await expect(menu).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(menu).not.toBeInViewport()

  await page.getByRole('button', { name: 'Mostrar ou esconder o menu' }).click()
  await menu.getByRole('link', { name: 'Integrações' }).click()
  await expect(page.getByRole('heading', { name: 'Integrações', level: 1 })).toBeVisible()
  await expect(menu).not.toBeInViewport()
})

test('the search opens over the header and finds a card by its key', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click()
  await page.getByLabel('Buscar cards ou ir para uma chave').fill('PRD-6')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/card=PRD-6/)
})

const SCREENS = [
  '/',
  '/espacos',
  '/espacos/PRD',
  '/espacos/PRD?aba=lista',
  '/espacos/PRD?aba=backlog',
  '/espacos/PRD?aba=pessoas',
  '/integracoes',
  '/perfil',
  '/propostas',
  '/notificacoes',
  '/grupos',
  '/pessoas',
  '/configuracoes',
  '/draw'
]

const fitsEveryScreen = async (page: Page) => {
  await signIn(page)
  for (const path of SCREENS) {
    await page.goto(path)
    await expect(page.locator('#view')).not.toBeEmpty()
    expect(await overflowsSideways(page), path).toBe(false)
  }
}

test('no screen is wider than the phone', async ({ page }) => await fitsEveryScreen(page))

test.describe('on a tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 } })

  test('no screen is wider than the tablet, and the menu sits beside the page', async ({ page }) => {
    await fitsEveryScreen(page)
    await page.goto('/')
    await expect(page.getByRole('navigation').filter({ hasText: 'Para você' })).toBeInViewport()
  })
})
