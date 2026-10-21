/**
 * CSV for what an auditor takes away and what an admin brings in (ADR-0024): comma-separated, RFC
 * 4180 quoting, and a BOM so a spreadsheet opens the accents right.
 *
 * @example toCsv([['nome', 'motivo'], ['Ana', 'disse "sim", depois']])   // 'nome,motivo\r\nAna,"disse ""sim"", depois"'
 */
const _cell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export const toCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(_cell).join(',')).join('\r\n')

/** The text as a file the browser saves — nothing leaves the panel. */
export const downloadCsv = (name: string, rows: readonly (readonly string[])[]): void => {
  const url = URL.createObjectURL(new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  URL.revokeObjectURL(url)
}

type Reader = { rows: string[][]; row: string[]; cell: string; quoted: boolean; separator: string }

/** Inside quotes: a doubled quote is one quote, a single one closes. Returns how many to skip. */
const _quoted = (reader: Reader, char: string, next: string | undefined): number => {
  if (char !== '"') {
    reader.cell += char
    return 0
  }
  if (next === '"') {
    reader.cell += '"'
    return 1
  }
  reader.quoted = false
  return 0
}

/** Outside quotes: opens a quote, ends a cell or a row, or joins the cell. */
const _plain = (reader: Reader, char: string): void => {
  if (char === '"') {
    reader.quoted = true
  } else if (char === reader.separator || char === '\n') {
    reader.row.push(reader.cell.trim())
    reader.cell = ''
    if (char === '\n') {
      reader.rows.push(reader.row)
      reader.row = []
    }
  } else if (char !== '\r') {
    reader.cell += char
  }
}

/**
 * Rows of a pasted CSV — commas or semicolons, as a spreadsheet in pt-BR exports — with quoted cells.
 *
 * @example parseCsv('a;b\n"x;y";z')   // [['a', 'b'], ['x;y', 'z']]
 */
export const parseCsv = (text: string): string[][] => {
  const separator = (text.split(/\r?\n/)[0] ?? '').includes(';') ? ';' : ','
  const reader: Reader = { rows: [], row: [], cell: '', quoted: false, separator }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (reader.quoted) {
      index += _quoted(reader, char, text[index + 1])
    } else {
      _plain(reader, char)
    }
  }
  reader.rows.push([...reader.row, reader.cell.trim()])
  return reader.rows.filter((row) => row.some((value) => value !== ''))
}
