import { crc32, deflateSync } from 'node:zlib'

import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 5e through the screens (ADR-0018): the account menu at the right of the header, the notification
 * preferences, and connecting Slack. The E2E stack runs the local Slack stand-in, so the consent screen is
 * the only step that would leave the machine: the test answers it as Slack would.
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const openAccount = async (page: Page) => await page.getByRole('button', { name: /^Sua conta/ }).click()

test('the account menu shows who is signed in, changes the theme and opens the notification preferences', async ({
  page
}) => {
  await signIn(page, 'ana@uselets.com')
  await openAccount(page)
  const menu = page.getByRole('menu', { name: 'Sua conta' })
  await expect(menu).toContainText('ana@uselets.com')
  await page.screenshot({ path: test.info().outputPath('menu.png') })
  await menu.getByRole('menuitemradio', { name: 'Escuro' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: test.info().outputPath('dark.png') })
  await openAccount(page)
  await menu.getByRole('menuitemradio', { name: 'Seguir o sistema' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)

  await openAccount(page)
  await page.getByRole('menuitem', { name: 'Notificações' }).click()
  await expect(page).toHaveURL(/\/notificacoes\/preferencias$/)
  await expect(page.getByRole('heading', { name: 'Preferências de notificação' })).toBeVisible()
  await expect(page.getByText('O Slack ainda não está conectado à organização.')).toBeVisible()
})

test('the old addresses of the settings open the notification preferences', async ({ page }) => {
  await signIn(page, 'ana@uselets.com')
  for (const old of ['/configuracoes', '/notificacoes?aba=preferencias']) {
    await page.goto(old)
    await expect(page).toHaveURL(/\/notificacoes\/preferencias$/)
    await expect(page.getByRole('combobox', { name: 'Como avisar: Atribuições' })).toBeVisible()
  }
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

  await page.goto('/notificacoes/preferencias')
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

/** A 600×400 picture, solid colour, as a PNG — wider than tall, so the panel crops its middle. */
const picture = (): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const [width, height] = [600, 400]
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([30, 120, 200]))])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))])
}

test('a person puts a photo on their profile from Editar perfil; the header shows it, and removing it brings the initials back', async ({
  page
}) => {
  await signIn(page, 'ana@uselets.com')
  await page.goto('/perfil')
  await expect(page.getByLabel('Escolher foto de perfil')).toHaveCount(0)
  await page.getByRole('button', { name: 'Editar perfil' }).click()
  const dialog = page.getByRole('dialog', { name: 'Editar perfil' })
  await dialog.getByLabel('Escolher foto de perfil').setInputFiles({
    name: 'eu.png',
    mimeType: 'image/png',
    buffer: picture()
  })
  await expect(page.getByText('Foto atualizada.')).toBeVisible()
  await expect(dialog.locator('.avatar-photo')).toBeVisible()
  const headerPhoto = page.locator('.account-button .avatar-photo')
  await expect(headerPhoto).toBeVisible()
  expect(await headerPhoto.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(256)
  for (const width of [1280, 390, 820]) {
    await page.setViewportSize({ width, height: 844 })
    await page.screenshot({ path: test.info().outputPath(`profile-photo-${width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  const picker = dialog.locator('.profile-photo-picker')
  await picker.hover()
  await expect(dialog.locator('.profile-photo-overlay')).toHaveCSS('opacity', '1')
  await picker.screenshot({ path: test.info().outputPath('profile-photo-hover.png') })
  await dialog.getByRole('button', { name: 'Remover foto' }).click()
  await expect(page.getByText('Foto removida.')).toBeVisible()
  await expect(page.locator('.avatar-photo')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Remover foto' })).toHaveCount(0)
  await expect(dialog.locator('.profile-photo-overlay')).toHaveText('Adicionar')
})

test('cancelling the photo picker keeps Editar perfil open', async ({ page }) => {
  await signIn(page, 'ana@uselets.com')
  await page.goto('/perfil')
  await page.getByRole('button', { name: 'Editar perfil' }).click()
  const dialog = page.getByRole('dialog', { name: 'Editar perfil' })
  // What the browser does when its file picker is closed without a file: a `cancel` that bubbles.
  await dialog
    .getByLabel('Escolher foto de perfil')
    .evaluate((element) => element.dispatchEvent(new Event('cancel', { bubbles: true })))
  await expect(dialog).toBeVisible()
})
