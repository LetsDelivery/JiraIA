import { expect, test } from '@playwright/test'

/**
 * The sidebar and Para você: a space opened shows up under "Recentes", a starred one under
 * "Marcados com estrela", and the task filters are all there.
 */
test('opening and starring a space fills the sidebar', async ({ page }) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill('ana@uselets.com')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Espaços recomendados' })).toBeVisible()
  for (const tab of ['Atribuídos a mim', 'Marcados com estrela', 'Recomendados']) {
    await expect(page.getByRole('tab', { name: tab })).toBeVisible()
  }

  await page.getByRole('main').getByText('Discovery Board', { exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Discovery Board', level: 1 })).toBeVisible()
  const sidebar = page.getByRole('complementary', { name: 'Menu principal' })
  const recent = sidebar.getByRole('group', { name: 'Recentes' })
  const starredGroup = sidebar.getByRole('group', { name: 'Marcados com estrela' })
  await expect(recent.getByRole('link', { name: 'Discovery Board' })).toBeVisible()

  const star = page.getByRole('button', { name: /Discovery Board com estrela|estrela de Discovery Board/ })
  if ((await star.getAttribute('aria-pressed')) === 'true') {
    await star.click()
  }
  await page.getByRole('button', { name: 'Marcar Discovery Board com estrela' }).click()
  await expect(starredGroup.getByRole('link', { name: 'Discovery Board' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remover estrela de Discovery Board' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await page.getByRole('button', { name: 'Remover estrela de Discovery Board' }).click()
  await expect(starredGroup.getByRole('link', { name: 'Discovery Board' })).toHaveCount(0)
  await expect(starredGroup.getByText('Nenhum espaço com estrela.')).toBeVisible()
})
