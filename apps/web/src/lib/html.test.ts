import { describe, expect, it } from 'vitest'

import { escapeText, html, raw } from './html'

describe('html', () => {
  it('escapes interpolated text, so a name cannot become markup', () => {
    expect(html`<h1>${'<script>alert(1)</script>'}</h1>`.value).toBe('<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>')
  })

  it('escapes quotes, so a value cannot leave its attribute', () => {
    expect(html`<a title="${'" onmouseover="x'}">`.value).toBe('<a title="&quot; onmouseover=&quot;x">')
  })

  it('nests templates and lists without escaping them twice', () => {
    expect(html`<ul>${['a', 'b'].map((item) => html`<li>${item}</li>`)}</ul>`.value).toBe(
      '<ul><li>a</li><li>b</li></ul>'
    )
  })

  it('drops undefined, null and false, and keeps zero', () => {
    expect(html`${undefined}${null}${false}${0}`.value).toBe('0')
  })

  it('inserts raw markup as is', () => {
    expect(html`${raw('<svg></svg>')}`.value).toBe('<svg></svg>')
  })
})

describe('escapeText', () => {
  it('escapes the five characters that matter in HTML', () => {
    expect(escapeText(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})
