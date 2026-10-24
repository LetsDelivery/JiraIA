import type { CardType } from '@/api/requests'
import { type Html, html } from '@/lib/html'

import { type IconName, icon } from './icons'

type TypeIcon = CardType['icon']
type TypeColor = CardType['color']

/** The panel's drawing of each icon name the API keeps (ADR-0031). */
export const TYPE_ICONS: Record<TypeIcon, { glyph: IconName; label: string }> = {
  checkbox: { glyph: 'squareCheck', label: 'Tarefa' },
  bookmark: { glyph: 'bookmark', label: 'História' },
  bug: { glyph: 'bug', label: 'Bug' },
  bolt: { glyph: 'bolt', label: 'Raio' },
  bulb: { glyph: 'bulb', label: 'Ideia' },
  flask: { glyph: 'flask', label: 'Experimento' },
  database: { glyph: 'database', label: 'Dados' },
  palette: { glyph: 'palette', label: 'Design' },
  subtask: { glyph: 'subtask', label: 'Subtarefa' },
  file: { glyph: 'file', label: 'Documento' },
  target: { glyph: 'target', label: 'Alvo' },
  flag: { glyph: 'flag', label: 'Bandeira' },
  star: { glyph: 'star', label: 'Estrela' },
  message: { glyph: 'message', label: 'Mensagem' },
  rocket: { glyph: 'rocket', label: 'Foguete' },
  layers: { glyph: 'stack', label: 'Camadas' }
}

export const TYPE_COLORS: Record<TypeColor, string> = {
  gray: 'Cinza',
  red: 'Vermelho',
  orange: 'Laranja',
  yellow: 'Amarelo',
  green: 'Verde',
  teal: 'Azul-petróleo',
  blue: 'Azul',
  violet: 'Violeta',
  pink: 'Rosa'
}

/** A type as its icon in its colour; the name goes in the tooltip unless it is shown beside. */
export const typeIcon = (type: Pick<CardType, 'icon' | 'color' | 'name'>, size = 16): Html =>
  html`<span class="type-icon type-${type.color}" title="${type.name}">${icon(TYPE_ICONS[type.icon].glyph, size)}</span>`
