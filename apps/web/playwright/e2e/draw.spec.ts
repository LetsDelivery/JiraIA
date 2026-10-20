import { type Browser, expect, type Page, test } from '@playwright/test'

/**
 * Let’s Draw AI (ADR-0010, ADR-0011): its own spaces, folders, pages and whiteboards, made blank or
 * from a prompt. Etapa 4 is done when two people edit the same page at the same time without losing
 * anything, and an old version is restored (prompt-construcao.md).
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const person = async (browser: Browser, email: string) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, email)
  return page
}

const editor = (page: Page) => page.locator('.page-editor .tiptap')
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Menu principal' })
const CONTENT_URL = /\/draw\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/

const openProduto = async (page: Page) => {
  await page.goto('/draw')
  await sidebar(page)
    .getByRole('link', { name: /Produto/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Produto' })).toBeVisible()
}

/** Something new in Produto, from the "+" beside "Conteúdo"; answers its address. */
const create = async (page: Page, option: 'Página em branco' | 'Quadro branco', title: string) => {
  await openProduto(page)
  await page.getByRole('button', { name: 'Criar conteúdo' }).click()
  await page.getByRole('menuitem', { name: new RegExp(option) }).click()
  await expect(page).toHaveURL(CONTENT_URL)
  await page.getByLabel('Título', { exact: true }).fill(title)
  await page.getByLabel('Título', { exact: true }).press('Tab')
  await expect(page.locator('[data-page-status]')).toHaveText('Ao vivo')
  return page.url()
}

test('JiraIA’s sidebar opens Let’s Draw AI in another tab; its spaces are its own', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  const button = page.getByRole('link', { name: /Let’s Draw AI/ })
  await expect(button).toHaveAttribute('target', '_blank')
  const [draw] = await Promise.all([page.waitForEvent('popup'), button.click()])
  await expect(draw.getByRole('heading', { name: 'Let’s Draw AI' })).toBeVisible()
  await expect(sidebar(draw).getByRole('group', { name: 'Espaços' })).toContainText('Produto')
  await expect(sidebar(draw).getByRole('group', { name: 'Espaços' })).not.toContainText('Discovery Board')
  await expect(sidebar(draw).getByRole('link', { name: /JiraIA/ })).toHaveAttribute('href', '/')
})

test('a space manager creates a space; folders and subfolders organise it; the sidebar searches and filters', async ({
  page
}) => {
  await signIn(page, 'ana@uselets.com')
  await page.goto('/draw')
  await page.getByRole('button', { name: 'Criar espaço' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Criar espaço' })
  await dialog.getByLabel('Nome').fill('Jurídico')
  await dialog.getByRole('button', { name: 'Criar espaço' }).click()
  await expect(page.getByRole('heading', { name: 'Jurídico' })).toBeVisible()

  const folder = async (open: () => Promise<void>, name: string) => {
    await open()
    await page.getByRole('menuitem', { name: /Pasta/ }).click()
    await page.getByRole('dialog', { name: 'Nova pasta' }).getByLabel('Nome').fill(name)
    await page.getByRole('dialog', { name: 'Nova pasta' }).getByRole('button', { name: 'Criar pasta' }).click()
    await expect(sidebar(page).getByRole('tree', { name: 'Conteúdo' })).toContainText(name)
  }
  await folder(() => page.getByRole('button', { name: 'Criar conteúdo' }).click(), 'Contratos')
  await folder(async () => {
    await page.locator('.page-tree-row').filter({ hasText: 'Contratos' }).hover()
    await page.getByRole('button', { name: 'Criar dentro de Contratos' }).click()
  }, 'Fornecedores')
  await expect(sidebar(page).getByRole('treeitem', { name: /Contratos/ })).toContainText('Fornecedores')

  await page.getByLabel('Pesquisar por título').fill('fornec')
  await expect(sidebar(page).getByRole('tree', { name: 'Conteúdo' })).toContainText('Fornecedores')
  await page.getByLabel('Pesquisar por título').fill('nada assim')
  await expect(sidebar(page).getByText('Nada encontrado.')).toBeVisible()
  await page.getByLabel('Pesquisar por título').fill('')

  await page.getByLabel('Mais ações do espaço').click()
  await page.getByRole('menuitem', { name: 'Marcar o espaço com estrela' }).click()
  await page.getByLabel('Mais ações do espaço').click()
  await expect(page.getByRole('menuitem', { name: 'Desmarcar estrela do espaço' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Configurações do espaço' })).toBeVisible()
})

test('“Criar com IA” drafts from a prompt in a chat, and the draft becomes a page', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await openProduto(page)
  await page.getByRole('button', { name: 'Criar conteúdo' }).click()
  await page.getByRole('menuitem', { name: /Criar com IA/ }).click()
  const ai = page.getByRole('dialog', { name: 'Criar com IA' })
  await expect(ai.getByRole('heading', { name: 'O que você vai criar hoje?' })).toBeVisible()
  await ai.getByRole('button', { name: 'Página', exact: true }).click()
  await ai
    .getByLabel('Descreva o que você quer criar')
    .fill('Processo de devolução de pedidos. Quem aprova e em quanto tempo.')
  await ai.getByLabel('Descreva o que você quer criar').press('Enter')

  await expect(ai.locator('.ai-turn-assistant')).toContainText('ponto de partida')
  await expect(ai.locator('.ai-draft')).toContainText('Processo de devolução de pedidos')
  await ai.getByRole('button', { name: 'Criar página' }).click()
  await expect(page).toHaveURL(CONTENT_URL)
  await expect(editor(page)).toContainText('Quem aprova e em quanto tempo.')
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true')
})

test('two people edit the same page at once and both keep what they wrote', async ({ browser }) => {
  const mine = await person(browser, 'admin@uselets.com')
  const hers = await person(browser, 'ana@uselets.com')
  const address = await create(mine, 'Página em branco', 'Ata da review')
  await hers.goto(address)
  await expect(hers.locator('[data-page-status]')).toHaveText('Ao vivo')
  await expect(mine.locator('.page-presence .presence')).toHaveCount(2)

  await editor(mine).click()
  await editor(hers).click()
  await Promise.all([mine.keyboard.type('Decisões do admin. '), hers.keyboard.type('Presentes: Ana. ')])

  for (const page of [mine, hers]) {
    await expect(editor(page)).toContainText('Decisões do admin.')
    await expect(editor(page)).toContainText('Presentes: Ana.')
  }
  const fresh = await person(browser, 'rui@uselets.com')
  await fresh.goto(address)
  await expect(editor(fresh)).toContainText('Decisões do admin.')
  await expect(editor(fresh)).toContainText('Presentes: Ana.')
})

test('an old version is compared and restored, and the restore reaches whoever is editing', async ({ browser }) => {
  const mine = await person(browser, 'admin@uselets.com')
  const address = await create(mine, 'Página em branco', 'Spec do rastreio')
  await editor(mine).click()
  await mine.keyboard.type('Primeira versão da spec.')
  await mine.getByRole('link', { name: 'Versões' }).click()
  await mine.getByRole('button', { name: 'Salvar versão agora' }).click()
  const saved = mine.locator('.toast').filter({ hasText: /^v\d+ salva\.$/ })
  await expect(saved).toBeVisible()
  const kept = (await saved.textContent())?.match(/v(\d+)/)?.[1] ?? ''

  await editor(mine).click()
  await mine.keyboard.press('ControlOrMeta+a')
  await mine.keyboard.type('Texto reescrito.')
  const hers = await person(browser, 'ana@uselets.com')
  await hers.goto(address)
  await expect(editor(hers)).toContainText('Texto reescrito.')

  await mine.getByRole('button', { name: new RegExp(`^v${kept} `) }).click()
  await expect(mine.locator('.diff')).toContainText('Primeira versão da spec.')
  mine.once('dialog', (dialog) => void dialog.accept())
  await mine.getByRole('button', { name: `Restaurar a v${kept}` }).click()
  await expect(mine.getByText(new RegExp(`v${kept} restaurada como v\\d`))).toBeVisible()
  await expect(editor(mine)).toHaveText('Primeira versão da spec.')
  await expect(editor(hers)).toHaveText('Primeira versão da spec.')
})

test('a whiteboard: one person draws a box with words, the other sees it', async ({ browser }) => {
  const mine = await person(browser, 'admin@uselets.com')
  const address = await create(mine, 'Quadro branco', 'Jornada do lojista')
  const hers = await person(browser, 'ana@uselets.com')
  await hers.goto(address)
  await expect(hers.locator('[data-page-status]')).toHaveText('Ao vivo')

  await mine.getByRole('button', { name: 'Retângulo' }).click()
  const canvas = mine.locator('.wb-canvas')
  await canvas.click({ position: { x: 400, y: 260 } })
  await mine.keyboard.press('Enter')
  await mine.getByRole('textbox', { name: 'Texto', exact: true }).fill('Atraso na coleta')
  await mine.getByRole('textbox', { name: 'Texto', exact: true }).press('Escape')

  await expect(mine.locator('.wb-scene text')).toHaveText('Atraso na coleta')
  await expect(hers.locator('.wb-scene text')).toHaveText('Atraso na coleta')
  await hers.reload()
  await expect(hers.locator('.wb-scene text')).toHaveText('Atraso na coleta')
})

test('blocks, a card in a sentence, a card from selected text and a comment on a stretch', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await create(page, 'Página em branco', 'Processo de triagem')
  await editor(page).click()
  await page.keyboard.type('/tabe')
  await expect(page.getByRole('listbox', { name: 'Blocos' })).toContainText('Tabela')
  await page.keyboard.press('Enter')
  await expect(editor(page).locator('table')).toBeVisible()

  await editor(page).locator('p').last().click()
  await page.keyboard.type('Ver #PRD-1')
  await expect(page.getByRole('listbox', { name: 'Cards' })).toContainText('PRD-1')
  await page.keyboard.press('Enter')
  await expect(editor(page).locator('.card-ref')).toContainText('Rastreio em tempo real no app do lojista')

  await page.keyboard.press('Enter')
  await page.keyboard.type('Avisar o lojista pelo WhatsApp')
  await editor(page).locator('p', { hasText: 'Avisar o lojista' }).click({ clickCount: 3 })
  await page.getByRole('toolbar', { name: 'Formatar o trecho' }).getByRole('button', { name: 'Criar card' }).click()
  const dialog = page.getByRole('dialog', { name: 'Criar card a partir do trecho' })
  await expect(dialog.getByLabel('Título')).toHaveValue('Avisar o lojista pelo WhatsApp')
  await dialog.getByRole('button', { name: 'Criar card' }).click()
  await expect(editor(page).locator('.card-ref').last()).toContainText('Avisar o lojista pelo WhatsApp')
  await expect(dialog).toHaveCount(0)

  // The paragraph holds only the card chip, a link: click past it, at the line's right end.
  const line = editor(page).locator('p', { hasText: 'Avisar o lojista' })
  const box = await line.boundingBox()
  await line.click({ position: { x: (box?.width ?? 10) - 4, y: (box?.height ?? 10) / 2 } })
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Prazo de 48 horas')
  await editor(page).locator('p', { hasText: 'Prazo de 48 horas' }).click({ clickCount: 3 })
  await page.getByRole('toolbar', { name: 'Formatar o trecho' }).getByRole('button', { name: 'Comentar' }).click()
  await page.getByLabel('Comentário no trecho').fill('Confirmar com o CS.')
  await page.locator('[data-page-comments] form[data-inline] button[type="submit"]').click()
  const thread = page.locator('[data-thread]').first()
  await expect(thread).toContainText('“Prazo de 48 horas”')
  await expect(editor(page).locator('.comment-anchor')).toHaveText('Prazo de 48 horas')
  await thread.getByRole('button', { name: 'Resolver' }).click()
  await expect(editor(page).locator('.comment-anchor')).toHaveCount(0)
})

test('an image and a file go into a page through the slash menu', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await create(page, 'Página em branco', 'Fluxo com imagem')
  await editor(page).click()
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  await page.keyboard.type('/imagem')
  const choosing = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  await (await choosing).setFiles({ name: 'fluxo.png', mimeType: 'image/png', buffer: png })
  const image = editor(page).locator('.page-image img')
  await expect(image).toHaveAttribute('src', /\/files\//)
  await expect.poll(async () => await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1)

  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('/anexo')
  const attaching = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  await (await attaching).setFiles({ name: 'escopo.txt', mimeType: 'text/plain', buffer: Buffer.from('escopo') })
  await expect(editor(page).locator('.page-file')).toContainText('escopo.txt')
})

test('a seeded page opens with its content, typing straight away loses none of it, and search finds it', async ({
  page
}) => {
  await signIn(page, 'admin@uselets.com')
  await openProduto(page)
  await sidebar(page).getByLabel('Pesquisar por título').fill('requisições')
  await sidebar(page)
    .getByRole('link', { name: /Requisições para Produto/ })
    .click()
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true')
  await expect(editor(page)).toContainText('Produto faz a triagem toda semana')
  await editor(page).locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Revisado em outubro.')
  await page.reload()
  await expect(editor(page)).toContainText('Itens concluídos. Revisado em outubro.')

  const box = page.getByRole('searchbox', { name: 'Buscar cards ou ir para uma chave' })
  await box.fill('triagem toda semana')
  await box.press('Enter')
  await expect(page.locator('.search-result').filter({ hasText: 'Requisições para Produto' })).toBeVisible()
})
