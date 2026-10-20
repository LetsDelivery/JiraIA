import { type Html, html } from '@/lib/html'
import { ARROWHEAD_LABEL } from '@/whiteboard/arrowheads'
import { applyGeometry, applyStyle, duplicateSelected, removeSelected, type StylePatch } from '@/whiteboard/commands'
import {
  type Arrowhead,
  canHoldText,
  type Element,
  type FrameElement,
  INK,
  isLinear,
  isShape,
  isText,
  type LinearElement,
  PALETTE,
  STROKE_WIDTHS,
  type Style,
  type TextElement,
  type TextStyle,
  TRANSPARENT
} from '@/whiteboard/elements'
import {
  align,
  bringForward,
  bringToFront,
  distribute,
  group,
  sendBackward,
  sendToBack,
  ungroup
} from '@/whiteboard/organize'
import type { Whiteboard } from '@/whiteboard/whiteboard'

import { type IconName, icon } from './icons'
import { bindSelects, selectField } from './select'

/**
 * The style panel (Etapa 4d, ADR-0017): beside the canvas, it shows what the selection can change — and,
 * with a drawing tool and nothing selected, the style the next element is drawn with. Changes apply as
 * they are chosen; there is nothing to confirm.
 */
type Current = Style & TextStyle & Partial<Pick<LinearElement, 'arrowType' | 'startArrowhead' | 'endArrowhead'>>

const NUMERIC = new Set(['strokeWidth', 'roughness', 'opacity', 'roundness', 'fontSize', 'lineHeight'])

const section = (title: string, body: Html): Html =>
  html`<fieldset class="wb-section"><legend>${title}</legend>${body}</fieldset>`

const choice = (
  key: string,
  value: string | number | null,
  current: unknown,
  label: string,
  content: Html | string
): Html =>
  html`<button type="button" class="wb-choice" data-style="${key}" data-value="${value === null ? 'none' : String(value)}" aria-pressed="${current === value}" aria-label="${label}" title="${label}">${content}</button>`

const swatch = (key: string, color: string, current: string, label: string): Html =>
  html`<button type="button" class="wb-swatch ${color === TRANSPARENT ? 'is-transparent' : ''}" data-style="${key}" data-value="${color}" aria-pressed="${current === color}" aria-label="${label}" title="${label}" style="--swatch: ${color}"></button>`

const colorRow = (key: 'strokeColor' | 'backgroundColor', current: string): Html => {
  const colors: { color: string; label: string }[] =
    key === 'strokeColor'
      ? [
          { color: INK, label: 'Traço preto' },
          ...PALETTE.map((each) => ({ color: each.stroke, label: `Traço ${each.name}` }))
        ]
      : [
          { color: TRANSPARENT, label: 'Fundo transparente' },
          ...PALETTE.map((each) => ({ color: each.fill, label: `Fundo ${each.name}` }))
        ]
  const custom = current !== TRANSPARENT && !colors.some((each) => each.color === current) ? current : ''
  return html`<div class="wb-swatches">
    ${colors.map((each) => swatch(key, each.color, current, each.label))}
    <label class="wb-picker ${custom ? 'is-custom' : ''}" title="Outra cor" style="--swatch: ${custom || '#ffffff'}">
      <input type="color" data-style="${key}" value="${custom || (current === TRANSPARENT ? '#ffffff' : current)}" aria-label="Escolher outra cor" />
    </label>
  </div>`
}

/** One click sets both colours of a meaning: the fill and the stroke that go with it. */
const paletteRow = (current: Current): Html => html`<div class="wb-swatches">
  ${PALETTE.map(
    (each) =>
      html`<button type="button" class="wb-swatch wb-swatch-pair" data-pair="${each.fill}|${each.stroke}" aria-pressed="${current.backgroundColor === each.fill && current.strokeColor === each.stroke}" aria-label="${each.name}" title="${each.name}" style="--swatch: ${each.fill}; --swatch-edge: ${each.stroke}"></button>`
  )}
</div>`

const FILLS: { value: Style['fillStyle']; label: string }[] = [
  { value: 'solid', label: 'Sólido' },
  { value: 'hachure', label: 'Hachura' },
  { value: 'cross-hatch', label: 'Hachura cruzada' },
  { value: 'zigzag', label: 'Zigue-zague' }
]
const WIDTHS: { value: number; label: string }[] = [
  { value: STROKE_WIDTHS.thin, label: 'Fina' },
  { value: STROKE_WIDTHS.normal, label: 'Normal' },
  { value: STROKE_WIDTHS.bold, label: 'Grossa' },
  { value: STROKE_WIDTHS.extra, label: 'Extra grossa' }
]
const DASHES: { value: Style['strokeStyle']; label: string }[] = [
  { value: 'solid', label: 'Sólido' },
  { value: 'dashed', label: 'Tracejado' },
  { value: 'dotted', label: 'Pontilhado' }
]
const ROUGHNESS: { value: number; label: string }[] = [
  { value: 0, label: 'Arquiteto' },
  { value: 1, label: 'Artista' },
  { value: 2, label: 'Cartunista' }
]

/** A small drawing of each option, so the choice is seen, not read. */
const sample = (key: string, value: string | number): Html => {
  const width = key === 'strokeWidth' ? Number(value) : 2
  const dash =
    key === 'strokeStyle' ? ({ solid: '', dashed: '5 4', dotted: '1 4' } as Record<string, string>)[String(value)] : ''
  const d =
    key === 'roughness'
      ? ['M3 12 L25 12', 'M3 12 Q9 8 14 12 T25 11', 'M3 13 Q7 6 12 13 T19 10 T25 13'][Number(value)]
      : 'M3 12 L25 12'
  return html`<svg width="28" height="24" viewBox="0 0 28 24" aria-hidden="true"><path d="${d ?? ''}" stroke="currentColor" stroke-width="${width}" stroke-dasharray="${dash ?? ''}" stroke-linecap="round" fill="none"></path></svg>`
}

const options = (key: string, list: { value: string | number; label: string }[], current: unknown, draw = true): Html =>
  html`<div class="wb-choices">${list.map((each) => choice(key, each.value, current, each.label, draw ? sample(key, each.value) : each.label))}</div>`

const slider = (key: string, label: string, value: number, min: number, max: number, step = 1): Html =>
  html`<label class="wb-slider"><span>${label}</span><input type="range" data-style="${key}" min="${min}" max="${max}" step="${step}" value="${value}" /><output>${value}</output></label>`

const ALIGN: { value: string; label: string; icon: IconName }[] = [
  { value: 'left', label: 'À esquerda', icon: 'alignLeft' },
  { value: 'center', label: 'No centro', icon: 'alignCenter' },
  { value: 'right', label: 'À direita', icon: 'alignRight' }
]
const VALIGN: { value: string; label: string; icon: IconName }[] = [
  { value: 'top', label: 'No topo', icon: 'alignTop' },
  { value: 'middle', label: 'No meio', icon: 'alignMiddle' },
  { value: 'bottom', label: 'Na base', icon: 'alignBottom' }
]
const FAMILIES = [
  { value: 'hand', label: 'Manuscrita' },
  { value: 'sans', label: 'Sans-serif' },
  { value: 'mono', label: 'Monoespaçada' }
]
const SIZES = [
  { value: 16, label: 'P' },
  { value: 20, label: 'M' },
  { value: 28, label: 'G' },
  { value: 36, label: 'GG' }
]

const textSection = (current: Current, inside: boolean): Html =>
  section(
    'Texto',
    html`${options('fontFamily', FAMILIES, current.fontFamily, false)}
    <div class="wb-row">${options('fontSize', SIZES, current.fontSize, false)}<input class="wb-number" type="number" min="4" max="400" data-style="fontSize" value="${current.fontSize}" aria-label="Tamanho da fonte" /></div>
    <div class="wb-choices">${ALIGN.map((each) => choice('textAlign', each.value, current.textAlign, each.label, icon(each.icon, 16)))}</div>
    ${inside ? html`<div class="wb-choices">${VALIGN.map((each) => choice('verticalAlign', each.value, current.verticalAlign, each.label, icon(each.icon, 16)))}</div>` : ''}
    ${slider('lineHeight', 'Altura da linha', current.lineHeight, 0.8, 2.5, 0.05)}`
  )

const HEADS: (Arrowhead | null)[] = [
  null,
  'arrow',
  'triangle',
  'bar',
  'dot',
  'circle',
  'diamond',
  'one',
  'many',
  'one-or-many',
  'zero-or-one',
  'zero-or-many'
]

const headSelect = (
  key: 'startArrowhead' | 'endArrowhead',
  label: string,
  current: Arrowhead | null | undefined
): Html =>
  selectField({
    name: key,
    label,
    value: current ?? 'none',
    options: HEADS.map((head) => ({ value: head ?? 'none', label: head ? ARROWHEAD_LABEL[head] : 'Sem ponta' }))
  })

const arrowSection = (current: Current): Html =>
  section(
    'Seta',
    html`${options(
      'arrowType',
      [
        { value: 'straight', label: 'Reta' },
        { value: 'curved', label: 'Curva' },
        { value: 'elbow', label: 'Cotovelo' }
      ],
      current.arrowType,
      false
    )}
    ${headSelect('startArrowhead', 'Início', current.startArrowhead)}${headSelect('endArrowhead', 'Fim', current.endArrowhead)}`
  )

const geometry = (element: Element): Html => {
  const field = (key: string, label: string, value: number) =>
    html`<label class="wb-field wb-field-small"><span>${label}</span><input class="wb-number" type="number" data-geometry="${key}" value="${Math.round(value)}" /></label>`
  return section(
    'Posição e tamanho',
    html`<div class="wb-grid">${field('x', 'X', element.x)}${field('y', 'Y', element.y)}${field('width', 'L', element.width)}${field('height', 'A', element.height)}${field('angle', 'Giro°', (element.angle * 180) / Math.PI)}</div>`
  )
}

const tool = (act: string, label: string, name: IconName, enabled = true): Html =>
  html`<button type="button" class="wb-tool" data-act="${act}" aria-label="${label}" title="${label}" ${enabled ? '' : html`disabled`}>${icon(name, 18)}</button>`

/** Layers for any selection; group, align and space out for several. */
const organizeSection = (selected: readonly Element[]): Html => {
  const many = selected.length > 1
  return section(
    'Organizar',
    html`<div class="wb-row">${tool('front', 'Trazer para frente (Ctrl Shift ])', 'arrowBarToUp')}${tool('forward', 'Trazer uma camada (Ctrl ])', 'arrowUp')}${tool('backward', 'Enviar uma camada (Ctrl [)', 'arrowDown')}${tool('back', 'Enviar para trás (Ctrl Shift [)', 'arrowBarToDown')}</div>
    <div class="wb-row">${tool('group', 'Agrupar (Ctrl G)', 'boxMultiple', many)}${tool(
      'ungroup',
      'Desagrupar (Ctrl Shift G)',
      'stack2',
      selected.some((element) => element.groupIds.length)
    )}</div>
    ${
      many
        ? html`<div class="wb-row">${tool('align-left', 'Alinhar à esquerda', 'layoutAlignLeft')}${tool('align-center', 'Centralizar na horizontal', 'layoutAlignCenter')}${tool('align-right', 'Alinhar à direita', 'layoutAlignRight')}${tool('align-top', 'Alinhar no topo', 'alignTop')}${tool('align-middle', 'Centralizar na vertical', 'alignMiddle')}${tool('align-bottom', 'Alinhar na base', 'alignBottom')}</div>
      <div class="wb-row">${tool('distribute-horizontal', 'Distribuir na horizontal', 'distributeHorizontal', selected.length > 2)}${tool('distribute-vertical', 'Distribuir na vertical', 'distributeVertical', selected.length > 2)}</div>`
        : ''
    }`
  )
}

/** A frame alone: its name, and picking it up with what it holds. */
const frameSection = (frame: FrameElement): Html =>
  section(
    'Frame',
    html`<input class="input" data-frame-name value="${frame.name}" maxlength="80" aria-label="Nome do frame" />
    <button type="button" class="button button-secondary button-small" data-act="frame-contents">Selecionar com o conteúdo</button>`
  )

const actions = (selected: readonly Element[]): Html => {
  const locked = selected.every((element) => element.locked)
  const [only] = selected
  return html`${selected.length === 1 && only ? section('Link', html`<input class="input wb-link" type="url" data-link placeholder="https://…" value="${only.link ?? ''}" aria-label="Link do elemento" />`) : ''}
    <div class="wb-actions">
      <button type="button" class="wb-tool" data-act="lock" aria-pressed="${locked}" aria-label="${locked ? 'Desbloquear' : 'Bloquear'}" title="${locked ? 'Desbloquear' : 'Bloquear para evitar edição acidental'}">${icon(locked ? 'lock' : 'lockOpen', 18)}</button>
      <button type="button" class="wb-tool" data-act="duplicate" aria-label="Duplicar" title="Duplicar (Ctrl D)">${icon('copy', 18)}</button>
      <button type="button" class="wb-tool" data-act="remove" aria-label="Excluir" title="Excluir (Delete)">${icon('trash', 18)}</button>
    </div>`
}

/** The text a shape holds, if it holds one. */
const textInside = (board: Whiteboard, element: Element | undefined): TextElement | undefined => {
  const id =
    element && canHoldText(element) ? element.boundElements.find((each) => each.type === 'text')?.id : undefined
  const text = id ? board.scene.get(id) : undefined
  return text && isText(text) ? text : undefined
}

/** What the panel shows from: the first selected element (its text, for a shape that holds one), or the defaults. */
const currentOf = (board: Whiteboard, selected: readonly Element[]): Current => {
  const [first] = selected
  const textStyle = (first && isText(first) ? first : textInside(board, first)) ?? board.textStyle
  return { ...board.style, ...board.textStyle, ...(first ?? {}), ...pickText(textStyle) } as Current
}

const pickText = ({ fontSize, fontFamily, textAlign, verticalAlign, lineHeight }: TextStyle): TextStyle => ({
  fontSize,
  fontFamily,
  textAlign,
  verticalAlign,
  lineHeight
})

/** Which sections apply: to what is selected, or to what the tool in hand will draw. */
type Shows = { shapes: boolean; strokes: boolean; texts: boolean; inside: boolean; arrows: boolean; corners: boolean }

const shows = (selected: readonly Element[], tool: string): Shows => {
  const kinds = new Set(selected.map((element) => element.type))
  return {
    shapes: selected.some(isShape) || ['rectangle', 'ellipse', 'diamond'].includes(tool),
    strokes: !(kinds.size === 1 && kinds.has('text')),
    texts: selected.some((element) => isText(element) || canHoldText(element)) || tool === 'text',
    inside: selected.some((element) => !isText(element) && canHoldText(element)),
    arrows: selected.some(isLinear),
    corners: kinds.has('rectangle') || kinds.has('diamond') || tool === 'rectangle' || tool === 'diamond'
  }
}

const colorSections = (current: Current, show: Shows): Html => {
  const fill = show.shapes && current.backgroundColor !== TRANSPARENT
  return html`${section('Paleta', paletteRow(current))}
    ${section('Traço', colorRow('strokeColor', current.strokeColor))}
    ${show.shapes ? section('Fundo', colorRow('backgroundColor', current.backgroundColor)) : ''}
    ${fill ? section('Preenchimento', options('fillStyle', FILLS, current.fillStyle, false)) : ''}`
}

const strokeSections = (current: Current, show: Shows): Html =>
  show.strokes
    ? html`${section('Espessura', options('strokeWidth', WIDTHS, current.strokeWidth))}
    ${section('Estilo do traço', options('strokeStyle', DASHES, current.strokeStyle))}
    ${section('Traçado', options('roughness', ROUGHNESS, current.roughness))}`
    : html``

const styleSections = (selected: readonly Element[], current: Current, tool: string): Html => {
  const show = shows(selected, tool)
  return html`
    ${colorSections(current, show)}
    ${strokeSections(current, show)}
    ${show.corners ? section('Cantos', slider('roundness', 'Arredondamento', current.roundness, 0, 48)) : ''}
    ${show.arrows ? arrowSection(current) : ''}
    ${show.texts ? textSection(current, show.inside) : ''}
    ${section('Opacidade', slider('opacity', 'Opacidade', current.opacity, 0, 100))}
  `
}

const boardSection = (board: Whiteboard): Html =>
  section(
    'Fundo do quadro',
    html`<div class="wb-swatches">${['#ffffff', '#f8f9fa', '#f5faff', '#fffce8', '#fdf8f6'].map((color) => html`<button type="button" class="wb-swatch" data-background="${color}" aria-pressed="${board.scene.settings.background === color}" aria-label="Fundo ${color}" style="--swatch: ${color}"></button>`)}
      <label class="wb-picker" title="Outra cor" style="--swatch: ${board.scene.settings.background}"><input type="color" data-background-custom value="${board.scene.settings.background}" aria-label="Escolher a cor de fundo" /></label></div>`
  )

/** What only a selection has: a frame's name, position and size, the layers, and the actions. */
const selectionSections = (selected: readonly Element[]): Html => {
  const [only] = selected
  if (!only) {
    return html``
  }
  const alone = selected.length === 1
  return html`${alone && only.type === 'frame' ? frameSection(only) : ''}
    ${alone ? geometry(only) : ''}
    ${organizeSection(selected)}
    ${actions(selected)}`
}

export const stylePanel = (board: Whiteboard): Html => {
  if (!board.editable) {
    return html``
  }
  const selected = board.selected()
  const drawing = !['select', 'hand', 'eraser', 'frame'].includes(board.tool)
  if (!selected.length && !drawing) {
    return html`<div class="wb-panel glass" aria-label="Quadro">${boardSection(board)}</div>`
  }
  return html`<div class="wb-panel glass" aria-label="Estilo">
    ${styleSections(selected, currentOf(board, selected), board.tool)}
    ${selectionSections(selected)}
  </div>`
}

const parse = (key: string, value: string): unknown =>
  value === 'none' ? null : NUMERIC.has(key) ? Number(value) : value

/** The panel's buttons, by the data attribute that marks each. */
const BUTTONS: [string, (board: Whiteboard, data: DOMStringMap) => void][] = [
  [
    'style',
    (board, data) => applyStyle(board, { [data.style ?? '']: parse(data.style ?? '', data.value ?? '') } as StylePatch)
  ],
  [
    'pair',
    (board, data) => {
      const [backgroundColor, strokeColor] = (data.pair ?? '').split('|')
      applyStyle(board, { backgroundColor, strokeColor } as StylePatch)
    }
  ],
  ['background', (board, data) => board.scene.setBackground(data.background ?? '')]
]

const ACTS: Record<string, (board: Whiteboard) => void> = {
  front: (board) => bringToFront(board),
  forward: (board) => bringForward(board),
  backward: (board) => sendBackward(board),
  back: (board) => sendToBack(board),
  group: (board) => group(board),
  ungroup: (board) => ungroup(board),
  'align-left': (board) => align(board, 'left'),
  'align-center': (board) => align(board, 'center'),
  'align-right': (board) => align(board, 'right'),
  'align-top': (board) => align(board, 'top'),
  'align-middle': (board) => align(board, 'middle'),
  'align-bottom': (board) => align(board, 'bottom'),
  'distribute-horizontal': (board) => distribute(board, 'horizontal'),
  'distribute-vertical': (board) => distribute(board, 'vertical'),
  'frame-contents': (board) => board.selectWithContents(board.selection[0] ?? ''),
  lock: (board) => applyStyle(board, { locked: !board.selected().every((element) => element.locked) }),
  duplicate: (board) => duplicateSelected(board),
  remove: (board) => removeSelected(board)
}

const onClick = (board: Whiteboard, target: HTMLElement): void => {
  const data = target.closest<HTMLElement>('button')?.dataset
  if (!data) {
    return
  }
  const button = BUTTONS.find(([key]) => data[key] !== undefined)
  if (button) {
    button[1](board, data)
  } else {
    ACTS[data.act ?? '']?.(board)
  }
}

/** Fields: a style, a position or size, the board's own colour, or the link. */
const FIELDS: [string, (board: Whiteboard, input: HTMLInputElement | HTMLSelectElement) => void][] = [
  [
    'style',
    (board, input) => {
      applyStyle(board, { [input.dataset.style ?? '']: parse(input.dataset.style ?? '', input.value) } as StylePatch)
      const output = input.parentElement?.querySelector('output')
      if (output) {
        output.textContent = input.value
      }
    }
  ],
  [
    'geometry',
    (board, input) => {
      const field = input.dataset.geometry ?? ''
      const number = Number(input.value)
      applyGeometry(board, { [field]: field === 'angle' ? (number * Math.PI) / 180 : number })
    }
  ],
  ['backgroundCustom', (board, input) => board.scene.setBackground(input.value)],
  [
    'frameName',
    (board, input) => {
      const [frame] = board.selected()
      if (frame?.type === 'frame' && input.value.trim()) {
        board.scene.step(() => board.scene.put({ ...frame, name: input.value.trim() }))
      }
    }
  ],
  ['link', (board, input) => applyStyle(board, { link: /^https?:\/\//.test(input.value) ? input.value : null })]
]

const onInput = (board: Whiteboard, input: HTMLInputElement | HTMLSelectElement): void => {
  FIELDS.find(([key]) => input.dataset[key] !== undefined)?.[1](board, input)
}

/**
 * Draws the panel again when the board changes — but not while a field in it is being used, so a slider
 * mid-drag or a number mid-typing keeps its focus.
 */
export const mountStylePanel = (host: HTMLElement, board: Whiteboard): void => {
  const draw = () => {
    if (
      !host.contains(document.activeElement) ||
      !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement)
    ) {
      host.innerHTML = stylePanel(board).value
      bindSelects(host)
    }
  }
  board.subscribe(draw)
  draw()
  host.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    onClick(board, target)
    // A button chosen, the keys go back to the board, so the next shortcut draws; a field keeps them.
    if (target.closest('button') && !target.closest('[data-select]')) {
      board.focus()
    }
  })
  host.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement
    if (input.type === 'range' || input.type === 'color') {
      onInput(board, input)
    }
  })
  host.addEventListener('select-change', (event) => {
    const input = (event.target as HTMLElement).querySelector<HTMLInputElement>('input[type="hidden"]')
    if (input) {
      applyStyle(board, { [input.name]: parse(input.name, input.value) } as StylePatch)
    }
  })
  host.addEventListener('change', (event) => onInput(board, event.target as HTMLInputElement | HTMLSelectElement))
}
