import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 1's flow through the screens: sign in, create a space with its key, give someone a role —
 * and the reader sees the space but none of the controls that change it.
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

/** A space by name, from the sidebar's "Todos os espaços". */
const openSpace = async (page: Page, name: string) => {
  await page.getByRole('group', { name: 'Todos os espaços' }).getByRole('link', { name }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
}

test('an admin creates a space with its key and gives a reader a role; the reader cannot change it', async ({
  page
}) => {
  await signIn(page, 'admin@uselets.com')
  await page.getByRole('button', { name: 'Criar espaço' }).click()
  const create = page.getByRole('dialog')
  await create.getByLabel('Nome').fill('Jurídico')
  await expect(create.getByLabel('Chave')).toHaveValue('JUR')
  await create.getByRole('combobox', { name: 'Tipo' }).click()
  await create.getByRole('option', { name: 'Negócios' }).click()
  await create.getByRole('button', { name: 'Criar espaço' }).click()

  await expect(page).toHaveURL(/\/espacos\/JUR$/)
  await expect(page.getByRole('heading', { name: 'Jurídico', level: 1 })).toBeVisible()
  await expect(page.getByText('Negócios · Líder: Admin Let’s')).toBeVisible()
  await expect(page.getByRole('region', { name: 'A fazer', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Pessoas e papéis' }).click()
  await page.getByRole('button', { name: 'Adicionar pessoa' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Pessoa' }).click()
  await dialog.getByRole('option', { name: 'Rui — rui@uselets.com' }).click()
  await dialog.getByRole('combobox', { name: 'Papel' }).click()
  await dialog.getByRole('option', { name: /^Leitor/ }).click()
  await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Rui', exact: true })).toBeVisible()

  await page.getByRole('button', { name: /^Sua conta/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await signIn(page, 'rui@uselets.com')
  await openSpace(page, 'Jurídico')

  await expect(page.getByText('JUR', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Adicionar pessoa' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Criar espaço' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Pessoas', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Solicitar acesso para editar' })).toBeVisible()
})

// Only the Workspace domain gets in (ADR-0005). The refusal is said on the sign-in screen.
test('an address of another domain is refused on the sign-in screen, with a sentence', async ({ page }) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill('alguem@gmail.com')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page.getByText('Só contas Google @uselets.com podem entrar no JiraIA.')).toBeVisible()
  await expect(page).toHaveURL(/\/entrar$/)
})

// ADR-0012: everyone of Let’s reads every space, and asks to edit; a space admin approves.
test('a newcomer reads every space, asks to edit one, and edits it once an admin approves', async ({ page }) => {
  const email = `nova.${Date.now().toString(36)}@uselets.com`
  await signIn(page, email)
  await expect(
    page.getByRole('group', { name: 'Todos os espaços' }).getByRole('link', { name: 'Requisições' })
  ).toBeVisible()
  await openSpace(page, 'Requisições')
  await page.getByRole('button', { name: 'Solicitar acesso para editar' }).click()
  await page.getByRole('dialog').getByLabel('Mensagem (opcional)').fill('Preciso abrir requisições.')
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar pedido' }).click()
  await expect(page.getByText('O pedido está com os administradores dele.')).toBeVisible()

  await page.getByRole('button', { name: /^Sua conta/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await signIn(page, 'admin@uselets.com')
  await openSpace(page, 'Requisições')
  await page.getByRole('link', { name: 'Pessoas e papéis' }).click()
  const request = page.locator('.request-row').filter({ hasText: email })
  await expect(request.getByText('Preciso abrir requisições.')).toBeVisible()
  await request.getByRole('button', { name: 'Aprovar como membro' }).click()
  await expect(page.getByRole('row').filter({ hasText: email }).getByRole('combobox')).toHaveText(/Membro/)

  await page.getByRole('button', { name: /^Sua conta/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await signIn(page, email)
  await openSpace(page, 'Requisições')
  await expect(page.getByRole('button', { name: 'Solicitar acesso para editar' })).toHaveCount(0)
})
