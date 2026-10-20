import { expect, test } from '@playwright/test'

/**
 * Espaços in the sidebar: `+` and the gear appear only on hover; the gear opens the management page,
 * where spaces are searched, filtered, archived and restored.
 */
test('Espaços: hover actions, folding, and managing spaces with search and filters', async ({ page }) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill('admin@uselets.com')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()

  const arrow = page.getByRole('button', { name: /(Recolher|Expandir) Espaços/ })
  const plus = page.getByRole('button', { name: 'Criar espaço' })
  const gear = page.getByRole('link', { name: 'Gerenciar espaços' })
  await page.mouse.move(800, 600)
  for (const control of [arrow, plus, gear]) {
    await expect(control).toHaveCSS('opacity', '0')
  }
  await page.getByRole('button', { name: 'Espaços', exact: true }).hover()
  for (const control of [arrow, plus, gear]) {
    await expect(control).toHaveCSS('opacity', '1')
  }

  const all = page.getByRole('group', { name: 'Todos os espaços' })
  await page.getByRole('button', { name: 'Recolher Espaços' }).click()
  await expect(all).toBeHidden()
  await page.getByRole('button', { name: 'Expandir Espaços' }).click()
  await expect(all).toBeVisible()

  await page.getByRole('button', { name: 'Espaços', exact: true }).hover()
  await gear.click()
  await expect(page.getByRole('heading', { name: 'Gerenciar espaços', level: 1 })).toBeVisible()
  for (const column of ['Nome', 'Chave', 'Tipo', 'Líder', 'Última atualização do ticket', 'URL do espaço']) {
    await expect(page.getByRole('columnheader', { name: column })).toBeVisible()
  }
  const requisicoes = page.getByRole('row', { name: /Requisições/ })
  await expect(requisicoes).toContainText('REQ')
  await expect(requisicoes).toContainText('Negócios')
  await expect(requisicoes).toContainText('/espacos/REQ')

  await page.getByPlaceholder('Pesquisar por nome ou chave').fill('tec')
  await expect(page.getByRole('row', { name: /Delivery Board/ })).toBeVisible()
  await expect(requisicoes).toBeHidden()
  await page.getByPlaceholder('Pesquisar por nome ou chave').fill('')

  await page.getByRole('combobox', { name: 'Tipo' }).click()
  await page.getByRole('option', { name: 'Software' }).click()
  await expect(page.getByRole('row', { name: /Delivery Board/ })).toBeVisible()
  await expect(requisicoes).toBeHidden()
  await page.getByRole('combobox', { name: 'Tipo' }).click()
  await page.getByRole('option', { name: 'Todos os tipos' }).click()

  await page.getByRole('button', { name: 'Arquivar Requisições' }).click()
  await expect(all.getByRole('link', { name: 'Requisições' })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Situação' }).click()
  await page.getByRole('option', { name: 'Arquivados' }).click()
  await page
    .getByRole('row', { name: /Requisições/ })
    .getByRole('button', { name: 'Restaurar' })
    .click()
  await expect(all.getByRole('link', { name: 'Requisições' })).toBeVisible()
})
