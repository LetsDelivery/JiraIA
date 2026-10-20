import { type Form, type FormQuestion, intakeRead, intakeWrite } from '@/api/intake'
import { read } from '@/api/requests'
import { PRIORITY_LABEL } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { spacePath } from '@/lib/space-types'
import { dateField } from '@/ui/date-picker'
import { icon } from '@/ui/icons'
import { selectField } from '@/ui/select'
import { toast } from '@/ui/toast'

import type { View } from './view'

const label = (question: FormQuestion): Html =>
  html`${question.label}${question.required ? html` <span class="required" aria-hidden="true">*</span>` : ''}`
const help = (question: FormQuestion): Html =>
  question.help ? html`<p class="field-hint">${question.help}</p>` : html``

const textInput = (question: FormQuestion, type: string): Html => html`
  <div class="field"><label for="answer-${question.id}">${label(question)}</label>
    <input id="answer-${question.id}" class="input" name="${question.id}" type="${type}" ${question.required ? html`required` : ''} />${help(question)}</div>
`

/** One question, drawn as the input its answer needs. */
const QUESTION: Record<string, (question: FormQuestion, people: { value: string; label: string }[]) => Html> = {
  text: (question) => textInput(question, 'text'),
  number: (question) => textInput(question, 'number'),
  url: (question) => textInput(question, 'url'),
  long_text: (question) => html`
    <div class="field"><label for="answer-${question.id}">${label(question)}</label>
      <textarea id="answer-${question.id}" class="input textarea" name="${question.id}" rows="4" ${question.required ? html`required` : ''}></textarea>${help(question)}</div>`,
  priority: (question) =>
    html`${selectField({ name: question.id, label: question.label, options: question.options.map((value) => ({ value, label: PRIORITY_LABEL[value as keyof typeof PRIORITY_LABEL] ?? value })), value: 'medium' })}${help(question)}`,
  date: (question) => html`${dateField({ name: question.id, label: question.label })}${help(question)}`,
  select: (question) =>
    html`${selectField({ name: question.id, label: question.label, options: question.options.map((value) => ({ value, label: value })), placeholder: 'Escolha…' })}${help(question)}`,
  multi_select: (question) => html`
    <div class="field"><span class="label">${label(question)}</span>
      <div class="chips" role="group" aria-label="${question.label}" data-multi-answer="${question.id}">
        ${question.options.map((option) => html`<button type="button" class="chip chip-toggle" data-option="${option}" aria-pressed="false">${option}</button>`)}
      </div>${help(question)}</div>`,
  person: (question, people) =>
    html`${selectField({ name: question.id, label: question.label, options: people, placeholder: 'Escolha…' })}${help(question)}`
}

const formMarkup = (form: Form, people: { value: string; label: string }[]): Html => html`
  <article class="form-page">
    <header class="form-page-head">
      <p class="muted"><a class="link" href="${spacePath(form.space.key)}">${form.space.key} · ${form.space.name}</a></p>
      <h1>${form.name}</h1>
      ${form.description ? html`<p class="form-page-lead">${form.description}</p>` : ''}
    </header>
    ${
      form.enabled
        ? html`<form class="form-page-body" data-answer-form>
            ${form.questions.map((question) => (QUESTION[question.kind] ?? QUESTION.text)?.(question, people) ?? '')}
            <button type="submit" class="button button-primary align-start">${icon('upload', 16)}Enviar</button>
          </form>`
        : html`<div class="empty"><p class="empty-title">Este formulário está pausado</p><p class="muted">Fale com quem cuida de ${form.space.name}.</p></div>`
    }
  </article>
`

const answersOf = (root: HTMLElement, form: Form): Record<string, unknown> => {
  const data = new FormData(root.querySelector('[data-answer-form]') as HTMLFormElement)
  const answers: Record<string, unknown> = {}
  for (const question of form.questions) {
    const multi = root.querySelector<HTMLElement>(`[data-multi-answer="${question.id}"]`)
    answers[question.id] = multi
      ? [...multi.querySelectorAll<HTMLElement>('[aria-pressed="true"]')].map((chip) => chip.dataset.option)
      : String(data.get(question.id) ?? '').trim()
  }
  return answers
}

const sent = (form: Form, card: { key: string; title: string }): Html => html`
  <div class="form-page-done">
    <p class="empty-title">Pedido enviado</p>
    <p>Virou <a class="link" href="${spacePath(form.space.key)}?card=${card.key}"><span class="key">${card.key}</span> ${card.title}</a>. Você é o relator e acompanha por lá.</p>
    <button type="button" class="button button-secondary align-start" data-send-another>Enviar outro</button>
  </div>
`

/** The card the last answer made, so a redraw after it shows the confirmation, not an empty form. */
let lastSent: { formId: string; card: { key: string; title: string } } | undefined

/** An intake form, by its link (escopo-mvp 4.1): anyone at LET’S fills it in; the answer becomes a card. */
export const formPageView: View = {
  path: '/formularios/:formId',
  title: 'Formulário',
  enter: async () => {
    lastSent = undefined
  },
  render: async ({ formId = '' }) => {
    const [form, members] = await Promise.all([intakeRead.form(formId), read.members()])
    if (lastSent?.formId === formId) {
      return html`<article class="form-page"><header class="form-page-head"><h1>${form.name}</h1></header>${sent(form, lastSent.card)}</article>`
    }
    const people = members.items
      .filter((member) => member.kind === 'person' && member.status === 'active')
      .map((member) => ({ value: member.id, label: member.name }))
    return formMarkup(form, people)
  },
  bind: (root, { formId = '' }) => {
    // Delegated: the confirmation is drawn in place after a send, after this bind ran.
    root.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-send-another]')) {
        lastSent = undefined
        navigate(location.pathname, true)
      }
    })
    root
      .querySelector('[data-multi-answer]')
      ?.closest('form')
      ?.addEventListener('click', (event) => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-multi-answer] [data-option]')
        chip?.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'))
      })
    root.querySelector('[data-answer-form]')?.addEventListener('submit', (event) => {
      event.preventDefault()
      void intakeRead
        .form(formId)
        .then(async (form) => {
          const answers = answersOf(root, form)
          const result = await intakeWrite.submit(formId, answers, form.space.id)
          lastSent = { formId, card: result.card }
          ;(root.querySelector('.form-page-body') as HTMLElement).outerHTML = sent(form, result.card).value
        })
        .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    })
  }
}
