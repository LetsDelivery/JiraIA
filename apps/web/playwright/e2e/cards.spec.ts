import { expect, type Page, test } from '@playwright/test'

/**
 * The rest of Etapa 2 on the Requisições space: custom fields, subtasks and typed links, comments with
 * mentions, reactions and edits, attachments, watchers, moving a card to another space, and the board's
 * lanes, the list and the backlog (escopo-mvp 2.5–2.14, 3.1–3.3).
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const openCard = async (page: Page, key: string) => {
  await page.goto(`/espacos/${key.split('-')[0]}?card=${key}`)
  const detail = page.getByRole('dialog', { name: new RegExp(`^${key} `) })
  await expect(detail).toBeVisible()
  return detail
}

test('custom fields: an admin adds a selection field and a card takes a value', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/REQ')
  await page.getByRole('button', { name: 'Campos' }).click()
  const editor = page.getByRole('dialog', { name: 'Campos do espaço' })
  await editor.getByRole('textbox', { name: 'Novo campo' }).fill('Frente')
  await editor.getByRole('combobox', { name: 'Tipo do novo campo' }).click()
  await editor.getByRole('option', { name: 'Seleção única' }).click()
  await editor.getByPlaceholder('Opções, separadas por vírgula (seleção)').fill('Pagamentos, Logística')
  await editor.getByRole('button', { name: 'Adicionar' }).click()
  await expect(editor.getByLabel('Nome do campo').last()).toHaveValue('Frente')
  await editor.getByRole('button', { name: 'Fechar' }).click()

  const detail = await openCard(page, 'REQ-1')
  await detail.getByRole('tab', { name: 'Tudo' }).click()
  await detail.getByRole('combobox', { name: 'Frente' }).click()
  await detail.getByRole('option', { name: 'Logística' }).click()
  await expect(detail.getByText('Frente: — → Logística')).toBeVisible()
})

test('squad: a card takes the group that owns it, and its history names the group', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  const detail = await openCard(page, 'REQ-2')
  await detail.getByRole('combobox', { name: 'Squad' }).click()
  await detail.getByRole('option', { name: 'Produto' }).click()
  await expect(detail.getByRole('combobox', { name: 'Squad' })).toContainText('Produto')
  await detail.getByRole('tab', { name: 'Tudo' }).click()
  await expect(detail.getByText('Squad: — → Produto')).toBeVisible()

  await detail.getByRole('combobox', { name: 'Squad' }).click()
  await detail.getByLabel('Buscar squad').fill('Squad Max (OMS, TMS)')
  await expect(detail.getByRole('option', { name: 'Tecnologia' })).toBeHidden()
  await detail.getByRole('button', { name: /Criar squad/ }).click()
  await expect(detail.getByRole('combobox', { name: 'Squad' })).toContainText('Squad Max (OMS, TMS)')
})

test('relations: a subtask, a typed link seen from both cards, and a parent to open', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  const detail = await openCard(page, 'REQ-1')
  await detail.getByRole('button', { name: 'Adicionar subtarefa' }).click()
  await detail.getByLabel('Nova subtarefa').fill('Levantar campos do relatório')
  await detail.getByLabel('Nova subtarefa').press('Enter')
  await expect(detail.locator('[data-relations]')).toContainText('Levantar campos do relatório')
  await expect(detail.getByLabel('Nova subtarefa')).toBeVisible()

  await detail.getByRole('button', { name: 'Vincular card' }).click()
  await detail.getByRole('combobox', { name: 'Tipo de vínculo' }).click()
  await detail.getByRole('option', { name: 'bloqueia', exact: true }).click()
  await detail.getByLabel('Chave do outro card').fill('REQ-2')
  await detail.getByRole('button', { name: 'Vincular' }).click()
  await expect(detail.locator('[data-relations]')).toContainText('bloqueia')
  await expect(detail.locator('[data-relations]')).toContainText('REQ-2')

  await detail.getByRole('button', { name: /REQ-2 Exportar faturas em lote/ }).click()
  const other = page.getByRole('dialog', { name: /^REQ-2 / })
  await expect(other.locator('[data-relations]')).toContainText('é bloqueado por')
  await expect(other.locator('[data-relations]')).toContainText('REQ-1')
})

test('relations: an existing card becomes a subtask, a pasted address links a card, and a new card is created linked', async ({
  page
}) => {
  await signIn(page, 'admin@uselets.com')
  const detail = await openCard(page, 'PRD-7')
  await detail.getByRole('button', { name: 'Adicionar subtarefa' }).click()
  await detail.getByRole('button', { name: 'Escolher um card já criado' }).click()
  await detail.getByLabel('Card existente').fill('PRD-8')
  await detail.getByRole('option', { name: /PRD-8/ }).click()
  await expect(detail.locator('[data-relations]')).toContainText('PRD-8')

  await detail.getByRole('button', { name: 'Vincular card' }).click()
  await detail.getByLabel('Chave do outro card').fill('http://localhost:5290/espacos/PRD?card=PRD-9')
  await detail.getByRole('button', { name: 'Vincular' }).click()
  await expect(detail.locator('[data-relations]')).toContainText('PRD-9')

  await detail.getByLabel('Chave do outro card').fill('Revisar contrato com o parceiro')
  await detail.getByRole('button', { name: 'Criar card vinculado' }).click()
  await expect(detail.locator('[data-relations]')).toContainText('Revisar contrato com o parceiro')
})

test('conversation: a mention makes Ana a watcher; a reaction and an edit stay on the comment', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  const detail = await openCard(page, 'REQ-2')
  const composer = detail.getByLabel('Novo comentário')
  await composer.fill('Pode revisar, @An')
  await detail.getByRole('option', { name: 'Ana' }).click()
  await detail.getByRole('button', { name: 'Comentar' }).click()
  const comment = detail.locator('[data-comment-id]').first()
  await expect(comment.locator('.mention')).toHaveText('@Ana')
  await expect(detail.getByRole('button', { name: /Observando/ })).toContainText('2')

  await comment.getByLabel('Reagir').click()
  await comment.getByRole('button', { name: '🚀', exact: true }).click()
  await expect(detail.locator('[data-comment-id]').first().getByRole('button', { name: '🚀 1' })).toBeVisible()

  await detail.locator('[data-comment-id]').first().getByRole('button', { name: 'Editar' }).click()
  await detail.getByLabel('Editar comentário').fill('Revisado, obrigado.')
  await detail.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(detail.locator('[data-comment-id]').first()).toContainText('Revisado, obrigado.')
  await expect(detail.locator('[data-comment-id]').first()).toContainText('editado')

  await detail.getByRole('button', { name: /Observando/ }).click()
  await expect(detail.getByRole('button', { name: /Observar/ })).toContainText('1')
})

test('attachments: a file goes up, opens by its link, and is removed', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  const detail = await openCard(page, 'REQ-2')
  await detail.locator('[data-file-input]').setInputFiles({
    name: 'escopo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Escopo do relatório de faturas')
  })
  const link = detail.getByRole('link', { name: 'escopo.txt' })
  await expect(link).toBeVisible()
  const download = await page.request.get((await link.getAttribute('href')) ?? '')
  expect(await download.text()).toBe('Escopo do relatório de faturas')

  await detail.getByRole('button', { name: 'Remover escopo.txt' }).click()
  await expect(detail.getByRole('link', { name: 'escopo.txt' })).toHaveCount(0)
})

test('a card moves to another space; its old key still opens it', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  const detail = await openCard(page, 'REQ-3')
  await detail.getByRole('button', { name: 'Mover para outro espaço' }).click()
  const form = page.getByRole('dialog', { name: 'Mover REQ-3 para outro espaço' })
  await form.getByRole('combobox', { name: 'Espaço de destino' }).click()
  await form.getByRole('option', { name: 'TEC · Delivery Board' }).click()
  await form.getByRole('button', { name: 'Mover' }).click()
  await expect(page.getByText('REQ-3 agora é TEC-1.')).toBeVisible()

  const moved = await page.request.get('http://localhost:8290/work/cards/by-key/REQ-3', {
    headers: { 'x-local-user': 'admin@uselets.com' }
  })
  expect((await moved.json()).key).toBe('TEC-1')
})

test('lanes, the list and the backlog show the same cards in their own ways', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.goto('/espacos/PRD')
  await page.getByRole('combobox', { name: 'Raias' }).click()
  await page.getByRole('option', { name: 'Responsável' }).click()
  await expect(page.locator('.lane-title').filter({ hasText: 'Ana' })).toBeVisible()
  await page.reload()
  await expect(page.locator('.lane-title').filter({ hasText: 'Ana' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Raias' }).click()
  await page.getByRole('option', { name: 'Sem raias' }).click()

  await page.getByRole('link', { name: 'Lista' }).click()
  const table = page.getByRole('table')
  await expect(table.getByRole('row')).not.toHaveCount(1)
  await table.getByRole('button', { name: 'Título' }).click()
  await expect(table.getByRole('columnheader', { name: 'Título' })).toHaveAttribute('aria-sort', 'ascending')
  await expect(table.getByRole('row').nth(1)).toContainText('Agendamento de coleta pelo painel')

  await page.getByRole('link', { name: 'Backlog' }).click()
  const backlog = page.locator('[data-backlog]')
  await expect(backlog.locator('.backlog-row')).not.toHaveCount(0)
  await expect(backlog).not.toContainText('Cotação simultânea de transportadoras')
  const first = backlog.locator('.backlog-row').first()
  const last = backlog.locator('.backlog-row').last()
  const moving = (await last.locator('.backlog-title').textContent()) ?? ''
  await last.dragTo(first, { targetPosition: { x: 10, y: 2 } })
  await expect(backlog.locator('.backlog-row').first()).toContainText(moving)
  await page.reload()
  await expect(page.locator('[data-backlog] .backlog-row').first()).toContainText(moving)
})
