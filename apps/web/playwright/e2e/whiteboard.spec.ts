import { expect, type Page, test } from '@playwright/test'

/**
 * Etapa 4d through the screens (ADR-0017): the whiteboard's tools, the style panel, text inside shapes,
 * selection and transforms, and undo — each element an object of its own in the shared document.
 */
const signIn = async (page: Page, email: string) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
}

const newBoard = async (page: Page, title: string) => {
  await signIn(page, 'admin@uselets.com')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/draw')
  await page.getByRole('complementary', { name: 'Menu principal' }).getByRole('link', { name: 'Produto' }).click()
  await page.getByRole('button', { name: 'Criar conteúdo' }).click()
  await page.getByRole('menuitem', { name: /Quadro branco/ }).click()
  await page.getByLabel('Título', { exact: true }).fill(title)
  await page.getByLabel('Título', { exact: true }).press('Tab')
  await expect(page.locator('[data-page-status]')).toHaveText('Ao vivo')
}

const canvas = (page: Page) => page.locator('.wb-canvas')

/** A drag on the canvas, in its own pixels. */
const drag = async (page: Page, from: [number, number], to: [number, number]) => {
  const box = await canvas(page).boundingBox()
  const [x, y] = [box?.x ?? 0, box?.y ?? 0]
  await page.mouse.move(x + from[0], y + from[1])
  await page.mouse.down()
  await page.mouse.move(x + (from[0] + to[0]) / 2, y + (from[1] + to[1]) / 2, { steps: 4 })
  await page.mouse.move(x + to[0], y + to[1], { steps: 4 })
  await page.mouse.up()
}

const write = async (page: Page, text: string) => {
  await page.getByRole('textbox', { name: 'Texto', exact: true }).fill(text)
  await page.getByRole('textbox', { name: 'Texto', exact: true }).press('Escape')
}

const elements = (page: Page) => page.locator('.wb-scene .wb-element')

test('draws shapes with words, an arrow and a stroke, styled from the panel', async ({ page }) => {
  await newBoard(page, 'Fluxo de pedido')

  await page.getByRole('button', { name: 'Retângulo' }).click()
  await drag(page, [380, 160], [580, 260])
  await page.keyboard.press('Enter')
  await write(page, 'Pedido criado')
  await page.getByRole('button', { name: 'Sucesso', exact: true }).click()

  await page.keyboard.press('d')
  await drag(page, [700, 140], [880, 280])
  await page.keyboard.press('Enter')
  await write(page, 'Pago?')
  await page.getByRole('button', { name: 'Aviso', exact: true }).click()
  await page.getByRole('button', { name: 'Hachura', exact: true }).click()

  await page.keyboard.press('o')
  await drag(page, [500, 520], [680, 620])
  await page.getByRole('button', { name: 'Erro', exact: true }).click()
  await page.getByRole('button', { name: 'Cartunista' }).click()

  await page.keyboard.press('a')
  await drag(page, [590, 210], [690, 210])
  await page.getByRole('button', { name: 'Tracejado' }).click()

  await page.keyboard.press('p')
  await drag(page, [760, 470], [920, 540])
  await page.keyboard.press('Escape')
  await canvas(page).dblclick({ position: { x: 320, y: 660 } })
  await write(page, 'Nota solta no quadro')

  await page.screenshot({ path: test.info().outputPath('diagram.png') })
  await expect(elements(page)).toHaveCount(8)
  await expect(page.locator('.wb-scene text', { hasText: 'Pedido criado' })).toBeVisible()
})

test('selects, moves, resizes, rotates, duplicates, deletes and undoes', async ({ page }) => {
  await newBoard(page, 'Transformações')
  await page.keyboard.press('r')
  await drag(page, [400, 200], [560, 300])
  await expect(page.locator('.wb-handle')).toHaveCount(9)

  await drag(page, [480, 250], [640, 330])
  const moved = page.getByRole('spinbutton', { name: 'X' })
  await expect(moved).not.toHaveValue('')

  await page.keyboard.press('ControlOrMeta+d')
  await expect(elements(page)).toHaveCount(2)
  await page.keyboard.press('Delete')
  await expect(elements(page)).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(elements(page)).toHaveCount(2)

  await drag(page, [300, 120], [900, 600])
  await expect(page.locator('.wb-selection-member')).toHaveCount(2)
  await page.screenshot({ path: test.info().outputPath('selection.png') })
})

const API = 'http://localhost:8290/work'
const AS_ADMIN = { 'x-local-user': 'admin@uselets.com' }

/** A whiteboard made through the API from stored JSON, as a draft or an import would make it. */
const boardFrom = async (page: Page, title: string, json: Record<string, unknown>) => {
  const spaces = (await (await page.request.get(`${API}/draw/spaces`, { headers: AS_ADMIN })).json()) as {
    items: { id: string; name: string }[]
  }
  const space = spaces.items.find((each) => each.name === 'Produto')
  const created = (await (
    await page.request.post(`${API}/draw/spaces/${space?.id}/contents`, {
      headers: AS_ADMIN,
      data: { kind: 'whiteboard', title, draft: { json, text: title } }
    })
  ).json()) as { id: string }
  await page.goto(`/draw/${space?.id}/${created.id}`)
  await expect(page.locator('[data-page-status]')).toHaveText('Ao vivo')
}

const base = {
  angle: 0,
  seed: 7,
  strokeWidth: 2,
  strokeStyle: 'solid',
  fillStyle: 'solid',
  roughness: 1,
  opacity: 100,
  roundness: 8,
  groupIds: [],
  frameId: null,
  locked: false,
  link: null,
  boundElements: []
}
const shape = (id: string, type: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  type,
  x,
  y,
  width: 160,
  height: 100,
  z: 1,
  strokeColor: '#1971c2',
  backgroundColor: '#a5d8ff',
  ...extra
})
const arrow = (id: string, x: number, y: number, extra: Record<string, unknown>) => ({
  ...base,
  id,
  type: 'arrow',
  x,
  y,
  width: 140,
  height: 0,
  z: 2,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  points: [
    [0, 0],
    [140, 0]
  ],
  arrowType: 'straight',
  startArrowhead: null,
  endArrowhead: 'arrow',
  startBinding: null,
  endBinding: null,
  ...extra
})

test('draws every kind of element from stored JSON, in the light and the dark theme', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  await page.setViewportSize({ width: 1600, height: 1000 })
  const elements = [
    shape('r1', 'rectangle', 40, 40, { roughness: 0, boundElements: [{ id: 't1', type: 'text' }] }),
    {
      ...base,
      id: 't1',
      type: 'text',
      x: 40,
      y: 40,
      width: 160,
      height: 100,
      z: 3,
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      text: 'Arquiteto, sólido',
      fontSize: 18,
      fontFamily: 'sans',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.25,
      containerId: 'r1',
      autoResize: false
    },
    shape('e1', 'ellipse', 240, 40, { fillStyle: 'cross-hatch', strokeColor: '#2f9e44', backgroundColor: '#b2f2bb' }),
    shape('d1', 'diamond', 440, 40, {
      fillStyle: 'zigzag',
      roughness: 2,
      strokeColor: '#f08c00',
      backgroundColor: '#ffec99',
      strokeStyle: 'dotted'
    }),
    shape('r2', 'rectangle', 640, 40, {
      angle: 0.3,
      strokeWidth: 6,
      strokeColor: '#e03131',
      backgroundColor: 'transparent',
      opacity: 60
    }),
    arrow('a1', 40, 220, { endArrowhead: 'triangle', startArrowhead: 'dot' }),
    arrow('a2', 220, 220, { arrowType: 'curved', endArrowhead: 'diamond' }),
    arrow('a3', 400, 200, {
      arrowType: 'elbow',
      points: [
        [0, 0],
        [140, 60]
      ],
      height: 60,
      endArrowhead: 'many',
      startArrowhead: 'one'
    }),
    arrow('a4', 580, 220, { endArrowhead: 'zero-or-many', startArrowhead: 'zero-or-one', strokeStyle: 'dashed' }),
    {
      ...base,
      id: 'f1',
      type: 'frame',
      x: 20,
      y: 320,
      width: 420,
      height: 200,
      z: 0,
      strokeColor: '#868e96',
      backgroundColor: 'transparent',
      name: 'Frame nomeado'
    },
    {
      ...base,
      id: 't2',
      type: 'text',
      x: 480,
      y: 340,
      width: 300,
      height: 90,
      z: 4,
      strokeColor: '#9c36b5',
      backgroundColor: 'transparent',
      text: 'Texto solto manuscrito\nem duas linhas',
      fontSize: 28,
      fontFamily: 'hand',
      textAlign: 'left',
      verticalAlign: 'top',
      lineHeight: 1.25,
      containerId: null,
      autoResize: true
    }
  ]
  await boardFrom(page, 'Galeria', { elements })
  await expect(page.locator('.wb-scene .wb-element')).toHaveCount(elements.length)
  await page.screenshot({ path: test.info().outputPath('gallery-light.png') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: test.info().outputPath('gallery-dark.png') })
})

test('opens a board drawn before Etapa 4d, its notes as shapes with their words inside', async ({ page }) => {
  await signIn(page, 'admin@uselets.com')
  const shapes = [
    { id: 'n1', kind: 'note', x: 40, y: 40, w: 180, h: 180, text: 'Ideia antiga', color: 'yellow' },
    {
      id: 'l1',
      kind: 'line',
      x: 240,
      y: 120,
      w: 0,
      h: 0,
      text: '',
      color: 'blue',
      points: [
        [0, 0],
        [120, 0]
      ]
    }
  ]
  await boardFrom(page, 'Quadro antigo', { shapes })
  await expect(page.locator('.wb-scene text')).toHaveText('Ideia antiga')
  await expect(page.locator('.wb-scene .wb-element')).toHaveCount(3)
})

// ---------- Etapa 4d-b ----------

const box = async (page: Page, selector: string) =>
  (await page.locator(selector).first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
const shapeAt = (page: Page, index: number) => page.locator('.wb-scene .wb-elements .wb-element').nth(index)
const spinValue = async (page: Page, label: string) =>
  Number(await page.getByRole('spinbutton', { name: label, exact: true }).inputValue())

test('an arrow tied to two shapes follows them, and its points can be reshaped', async ({ page }) => {
  await newBoard(page, 'Conexões')
  await page.keyboard.press('r')
  await drag(page, [320, 160], [460, 240])
  await page.keyboard.press('r')
  await drag(page, [640, 160], [780, 240])
  await page.keyboard.press('a')
  await drag(page, [450, 200], [650, 200])
  await expect(shapeAt(page, 2)).toBeVisible()
  const before = await shapeAt(page, 2).boundingBox()

  await page.keyboard.press('Escape')
  await drag(page, [710, 200], [710, 420])
  await expect
    .poll(async () => ((await shapeAt(page, 2).boundingBox())?.height ?? 0) - (before?.height ?? 0))
    .toBeGreaterThan(150)

  await canvas(page).click({ position: { x: 550, y: 310 } })
  await expect(page.locator('.wb-point')).toHaveCount(2)
  const middle = await box(page, '.wb-midpoint')
  await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2)
  await page.mouse.down()
  await page.mouse.move(middle.x + 40, middle.y + 120, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.wb-point')).toHaveCount(3)
  await page.screenshot({ path: test.info().outputPath('connections.png') })
})

test('groups move together; align, layers and copy and paste work on the selection', async ({ page }) => {
  await newBoard(page, 'Organização')
  await page.keyboard.press('r')
  await drag(page, [320, 160], [440, 240])
  await page.keyboard.press('o')
  await drag(page, [520, 200], [640, 300])

  await drag(page, [300, 120], [700, 360])
  await page.getByRole('button', { name: 'Alinhar no topo' }).click()
  await page.getByRole('button', { name: 'Agrupar (Ctrl G)' }).click()
  await page.keyboard.press('Escape')
  await canvas(page).click({ position: { x: 380, y: 200 } })
  await expect(page.locator('.wb-selection-member')).toHaveCount(2)

  await page.keyboard.press('ControlOrMeta+Shift+g')
  await canvas(page).click({ position: { x: 900, y: 600 } })
  await canvas(page).click({ position: { x: 580, y: 220 } })
  await expect(page.locator('.wb-selection-member')).toHaveCount(0)
  const ellipseY = await spinValue(page, 'Y')
  await canvas(page).click({ position: { x: 380, y: 200 } })
  expect(await spinValue(page, 'Y')).toBe(ellipseY)

  await page.getByRole('button', { name: 'Enviar para trás (Ctrl Shift [)' }).click()
  await page.getByRole('button', { name: 'Trazer para frente (Ctrl Shift ])' }).click()

  await page.keyboard.press('ControlOrMeta+c')
  await page.mouse.move((await box(page, '.wb-canvas')).x + 800, (await box(page, '.wb-canvas')).y + 500)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator('.wb-scene .wb-elements > .wb-element')).toHaveCount(3)
})

test('a frame takes what is inside it along, and a move shows its alignment guide', async ({ page }) => {
  await newBoard(page, 'Frames')
  await page.keyboard.press('f')
  await drag(page, [320, 140], [720, 440])
  await page.keyboard.press('r')
  await drag(page, [380, 220], [500, 300])
  await expect(shapeAt(page, 1)).toBeVisible()
  const inside = await shapeAt(page, 1).boundingBox()

  await canvas(page).click({ position: { x: 330, y: 130 } })
  await drag(page, [330, 130], [430, 180])
  await expect
    .poll(async () => Math.round(((await shapeAt(page, 1).boundingBox())?.x ?? 0) - (inside?.x ?? 0)))
    .toBe(100)

  await page.keyboard.press('r')
  await drag(page, [800, 300], [900, 360])
  const start = await box(page, '.wb-canvas')
  await page.mouse.move(start.x + 850, start.y + 330)
  await page.mouse.down()
  // Its top comes level with the top of the box inside the frame: the guide shows it.
  await page.mouse.move(start.x + 850, start.y + 302, { steps: 5 })
  await expect(page.locator('.wb-guide')).not.toHaveCount(0)
  await page.mouse.up()
  await page.screenshot({ path: test.info().outputPath('frames.png') })
})

// ---------- Etapa 4d-c ----------

/** A 2×1 PNG, red and blue, so an image has something to show. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==',
  'base64'
)

test('adds an image, exports PNG, SVG and .json, and opens the .json again', async ({ page }) => {
  await newBoard(page, 'Arquivos')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Imagem', exact: true }).click()
  await (await chooser).setFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.locator('.wb-scene image')).toHaveCount(1)
  await page.keyboard.press('r')
  await drag(page, [320, 420], [460, 500])

  await page.getByRole('button', { name: 'Exportar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Exportar quadro' })
  const png = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Baixar PNG' }).click()
  expect((await png).suggestedFilename()).toBe('Arquivos.png')
  const svg = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Baixar SVG' }).click()
  const svgText = await (await (await svg).createReadStream()).toArray()
  expect(Buffer.concat(svgText).toString()).toContain('data:image/png;base64')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await dialog.getByRole('button', { name: 'Copiar imagem' }).click()
  await expect(page.locator('.toast', { hasText: 'Imagem copiada.' })).toBeVisible()
  const json = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Baixar .json' }).click()
  const saved = await (await json).path()
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  const opening = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Abrir arquivo' }).click()
  await (await opening).setFiles(saved)
  await expect(page.locator('.wb-scene .wb-elements .wb-element')).toHaveCount(4)
})

test('opens an Excalidraw file: shapes, the text inside them and the arrow between them', async ({ page }) => {
  await newBoard(page, 'Do Excalidraw')
  const common = {
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: 1,
    isDeleted: false,
    link: null,
    locked: false
  }
  const scene = {
    type: 'excalidraw',
    version: 2,
    elements: [
      {
        ...common,
        id: 'a',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 160,
        height: 80,
        boundElements: [
          { id: 't', type: 'text' },
          { id: 'x', type: 'arrow' }
        ]
      },
      {
        ...common,
        id: 't',
        type: 'text',
        x: 10,
        y: 20,
        width: 140,
        height: 25,
        boundElements: null,
        text: 'Início',
        originalText: 'Início',
        fontSize: 20,
        fontFamily: 5,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: 'a',
        lineHeight: 1.25
      },
      {
        ...common,
        id: 'b',
        type: 'diamond',
        x: 300,
        y: -20,
        width: 140,
        height: 120,
        boundElements: [{ id: 'x', type: 'arrow' }]
      },
      {
        ...common,
        id: 'x',
        type: 'arrow',
        x: 168,
        y: 40,
        width: 124,
        height: 0,
        boundElements: [],
        points: [
          [0, 0],
          [124, 0]
        ],
        startBinding: { elementId: 'a', focus: 0, gap: 8 },
        endBinding: { elementId: 'b', focus: 0, gap: 8 },
        startArrowhead: null,
        endArrowhead: 'arrow'
      }
    ],
    files: {}
  }
  const opening = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Abrir arquivo' }).click()
  await (await opening).setFiles({
    name: 'fluxo.excalidraw',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(scene))
  })
  await expect(page.locator('.wb-scene text', { hasText: 'Início' })).toBeVisible()
  await expect(page.locator('.wb-scene .wb-elements .wb-element')).toHaveCount(4)
  await page.screenshot({ path: test.info().outputPath('excalidraw.png') })
})

test('saves a named version, and the board is among what the person opened', async ({ page }) => {
  await newBoard(page, 'Com versão')
  await page.keyboard.press('r')
  await drag(page, [320, 200], [460, 280])
  await page.getByRole('button', { name: 'Salvar versão' }).click()
  await page.getByLabel('Nome (opcional)').fill('Antes da revisão')
  await page.getByRole('dialog', { name: 'Salvar versão' }).getByRole('button', { name: 'Salvar versão' }).click()
  await page
    .getByRole('tab', { name: /Versões/ })
    .or(page.getByRole('link', { name: /Versões/ }))
    .first()
    .click()
  await expect(page.getByText(/^v\d+ · Antes da revisão$/)).toBeVisible()

  // The board keeps a copy in this browser, for when the connection drops.
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map((each) => each.name ?? ''))
  expect(databases.some((name) => name.startsWith('jiraia:board:'))).toBe(true)

  await page.goto('/draw')
  await expect(page.getByRole('heading', { name: 'Abertos por você' })).toBeVisible()
  await expect(page.locator('.section', { hasText: 'Abertos por você' })).toContainText('Com versão')
})

test('an arrow ties where it is aimed on the outline, and with Alt it ties to nothing', async ({ page }) => {
  await newBoard(page, 'Pontas livres')
  await page.keyboard.press('o')
  await drag(page, [320, 160], [480, 260])
  await expect(shapeAt(page, 0)).toBeVisible()
  const ellipse = (await shapeAt(page, 0).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }

  await page.keyboard.press('a')
  await drag(page, [750, 450], [470, 172])
  await expect(shapeAt(page, 1)).toBeVisible()
  const aimed = (await shapeAt(page, 1).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
  expect(aimed.y, 'the tip sits on the upper right of the outline, not the middle of its side').toBeLessThan(
    ellipse.y + ellipse.height / 4
  )

  await page.keyboard.press('a')
  await page.keyboard.down('Alt')
  await drag(page, [750, 600], [482, 210])
  await page.keyboard.up('Alt')
  await expect(shapeAt(page, 2)).toBeVisible()
  const loose = await shapeAt(page, 2).boundingBox()
  await page.keyboard.press('Escape')
  await drag(page, [400, 175], [400, 375])
  await expect
    .poll(async () => await shapeAt(page, 2).boundingBox(), { message: 'the loose arrow stays where it was dropped' })
    .toEqual(loose)
  await expect
    .poll(async () => (await shapeAt(page, 1).boundingBox())?.y ?? 0, { message: 'the tied arrow follows the shape' })
    .toBeGreaterThan(aimed.y + 100)
})

test('a text takes its own colour, bold, italic, underline and a size typed in', async ({ page }) => {
  await newBoard(page, 'Texto formatado')
  await page.getByRole('button', { name: 'Retângulo' }).click()
  await drag(page, [380, 160], [580, 260])
  await page.keyboard.press('Enter')
  await write(page, 'Entrega confirmada')
  await page.getByRole('button', { name: 'Erro', exact: true }).click()

  await page.getByRole('button', { name: 'Texto Sucesso' }).click()
  await page.getByRole('button', { name: 'Negrito' }).click()
  await page.getByRole('button', { name: 'Itálico' }).click()
  await page.getByRole('button', { name: 'Sublinhado' }).click()
  await page.getByRole('spinbutton', { name: 'Tamanho da fonte' }).fill('32')
  await page.getByRole('spinbutton', { name: 'Tamanho da fonte' }).press('Enter')

  const words = page.locator('.wb-scene text', { hasText: 'Entrega' })
  await expect(words).toHaveAttribute('fill', '#2f9e44')
  await expect(words).toHaveAttribute('font-weight', 'bold')
  await expect(words).toHaveAttribute('font-style', 'italic')
  await expect(words).toHaveAttribute('text-decoration', 'underline')
  await expect(words).toHaveAttribute('font-size', '32')
  const outline = page.locator('.wb-scene .wb-elements .wb-element').first().locator('path[stroke="#e03131"]')
  await expect(outline.first(), 'the shape keeps its own stroke').toBeAttached()
  await expect(page.getByRole('button', { name: 'Negrito' })).toHaveAttribute('aria-pressed', 'true')
})
