import { expect, type Page, test } from '@playwright/test'

/**
 * ADR-0012 through the screens: groups everyone can see, and a LET’S Draw AI space that whoever has
 * no role reads but cannot change — with the way to ask, and who holds which role, one menu away.
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Menu principal' })

test('everyone sees the groups and who is in them; only an admin creates one', async ({ page }) => {
  await signIn(page, 'rui@uselets.com')
  for (const name of ['Grupos', 'Acessos', 'Pessoas']) {
    await expect(sidebar(page).getByRole('link', { name, exact: true })).toHaveCount(0)
  }
  await page.goto('/grupos')

  const produto = page.locator('.group-card').filter({ hasText: 'Produto' })
  await expect(produto.locator('.person-name', { hasText: /^Ana/ })).toBeVisible()
  await expect(produto.getByText('dono')).toBeVisible()
  await expect(produto.locator('.group-grant').filter({ hasText: 'Discovery Board' }).getByText('Membro')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Criar grupo' })).toHaveCount(0)
  await expect(produto.getByRole('button', { name: 'Adicionar pessoa' })).toHaveCount(0)
})

test('the actions on a person sit behind ⋯ on Pessoas, which shows name, job title, e-mail and status', async ({
  page
}) => {
  await signIn(page, 'admin@uselets.com')
  await sidebar(page).getByRole('link', { name: 'Pessoas' }).click()

  await expect(page.getByRole('columnheader')).toHaveText(['Nome', 'Cargo', 'E-mail', 'Status', 'Ações'])
  await expect(page.getByRole('button', { name: 'Desativar' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ações de Rui' }).click()
  await expect(page.getByRole('menuitem', { name: 'Tornar gestor de espaços' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Desativar' })).toBeVisible()
})

test('a reader of a LET’S Draw AI space sees no create controls, asks to edit, and sees why others edit', async ({
  page
}) => {
  await signIn(page, 'rui@uselets.com')
  await page.goto('/draw')
  await sidebar(page)
    .getByRole('link', { name: /Produto/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Produto', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Criar espaço' })).toHaveCount(0)

  await expect(page.getByRole('button', { name: 'Criar conteúdo' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Criar', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Solicitar acesso para editar' })).toBeVisible()

  await sidebar(page).getByRole('button', { name: 'Mais ações do espaço' }).click()
  await page.getByRole('menuitem', { name: 'Pessoas e papéis' }).click()
  await expect(page.getByText('Toda a LET’S')).toBeVisible()
  const group = page.getByRole('row').filter({ hasText: 'Produto' })
  await expect(group.getByRole('cell', { name: 'Membro' })).toBeVisible()
  await page.getByRole('row').filter({ hasText: 'Admin LET’S' }).getByRole('button', { name: 'Por quê?' }).click()
  await expect(page.getByRole('dialog').getByText('Papel dado à pessoa: Administrador.')).toBeVisible()
})

test('"Criar" in the header makes a card in a space the person edits, and opens it', async ({ page }) => {
  await signIn(page, 'ana@uselets.com')
  await page.getByRole('banner').getByRole('button', { name: 'Criar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Criar card' })
  await dialog.getByRole('combobox', { name: 'Espaço' }).click()
  await expect(dialog.getByRole('option', { name: /TEC/ })).toHaveCount(0)
  await dialog.getByRole('option', { name: 'REQ · Requisições' }).click()
  await dialog.getByLabel('Título').fill('Pedido criado pelo atalho')
  await dialog.getByRole('button', { name: 'Criar', exact: true }).click()

  await expect(page).toHaveURL(/\/espacos\/REQ\?card=REQ-\d+$/)
  await expect(page.getByRole('dialog', { name: /REQ-\d+ Pedido criado pelo atalho/ })).toBeVisible()
})

test('"Criar" tells someone who edits no space how to ask, and is not in LET’S Draw AI', async ({ page }) => {
  await signIn(page, 'rui@uselets.com')
  await page.getByRole('banner').getByRole('button', { name: 'Criar', exact: true }).click()
  await expect(page.getByText('Você ainda não edita nenhum espaço.')).toBeVisible()
  await page.goto('/draw')
  await expect(page.getByRole('banner').getByRole('button', { name: 'Criar', exact: true })).toHaveCount(0)
})

test('a person sets their own job title on Meu perfil, and Pessoas shows it in its own column', async ({ page }) => {
  await signIn(page, 'rui@uselets.com')
  await page.goto('/perfil')
  await page.getByRole('button', { name: 'Editar perfil' }).click()
  const dialog = page.getByRole('dialog', { name: 'Editar perfil' })
  await expect(dialog.getByLabel('Nome')).toHaveValue('Rui')
  await dialog.getByLabel('Cargo').fill('Coordenador de operações')
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Coordenador de operações · rui@uselets.com')).toBeVisible()

  await page.getByRole('button', { name: /^Sua conta/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await signIn(page, 'admin@uselets.com')
  await sidebar(page).getByRole('link', { name: 'Pessoas' }).click()
  const row = page.getByRole('row').filter({ hasText: 'rui@uselets.com' })
  // The first cell is the avatar's initials, then the name (ADR-0039).
  await expect(row.getByRole('cell').nth(0)).toContainText('Rui')
  await expect(row.getByRole('cell').nth(1)).toHaveText('Coordenador de operações')
})

test('a role picker in a table row opens whole, above the rows instead of cut by the table', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/draw')
  await sidebar(page)
    .getByRole('link', { name: /Produto/ })
    .click()
  await sidebar(page).getByRole('button', { name: 'Mais ações do espaço' }).click()
  await page.getByRole('menuitem', { name: 'Pessoas e papéis' }).click()

  await page.getByRole('combobox', { name: 'Papel de Produto' }).click()
  for (const name of ['Administrador', 'Membro', 'Leitor']) {
    const option = page.getByRole('option', { name: new RegExp(`^${name}`) })
    const topmost = await option.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    })
    expect(topmost, `${name} is drawn, not clipped`).toBe(true)
  }
})
