import { type Automation, intakeRead, intakeWrite, type Run } from '@/api/intake'
import { read } from '@/api/requests'
import { describeAction, describeTrigger, type Names, RUN_STATUS_LABEL, stepLabel } from '@/lib/automations'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'

import { draftOf, payload } from './automation-draft'
import { type EditorContext, openAutomationEditor } from './automation-editor'
import { openFormDialog } from './dialog'
import { icon } from './icons'
import { toast } from './toast'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

/** Every space's workflow, the channels and this space's fields: what names a rule and fills its editor. */
const loadContext = async (spaceId: string): Promise<EditorContext> => {
  const [spaces, fields, channels] = await Promise.all([
    read.spaces(),
    read.fields(spaceId),
    intakeRead.slackChannels()
  ])
  const workflows = await Promise.all(
    spaces.items.map(async (space) => [space.id, await read.workflow(space.id)] as const)
  )
  return {
    spaceId,
    spaces: spaces.items,
    workflows: new Map(workflows),
    fields: fields.items,
    channels: channels.items
  }
}

const namesOf = (context: EditorContext): Names => {
  const all = [...context.workflows.values()]
  return {
    state: (id) =>
      all.flatMap((workflow) => workflow.states).find((state) => state.id === id)?.name ?? 'estado removido',
    type: (id) => all.flatMap((workflow) => workflow.types).find((type) => type.id === id)?.name ?? 'tipo removido',
    space: (id) => context.spaces.find((space) => space.id === id)?.key ?? 'espaço',
    channel: (id) => context.channels.find((channel) => channel.id === id)?.name ?? 'canal removido'
  }
}

const ruleCard = (rule: Automation, names: Names, manages: boolean): Html => html`
  <li class="intake-card" data-rule="${rule.id}">
    <div class="intake-card-head">
      <div class="intake-card-title">
        <h3>${rule.name}</h3>
        <span class="badge ${rule.enabled ? 'badge-on' : ''}">${rule.enabled ? 'Ligada' : 'Desligada'}</span>
      </div>
      <div class="row">
        <button type="button" class="button button-ghost button-small" data-runs aria-expanded="false">${icon('history', 16)}Execuções</button>
        ${
          manages
            ? html`<button type="button" class="button button-ghost button-small" data-toggle-rule>${rule.enabled ? 'Desligar' : 'Ligar'}</button>
          <button type="button" class="button button-ghost button-icon" data-edit-rule aria-label="Editar ${rule.name}">${icon('pencil', 16)}</button>
          <button type="button" class="button button-ghost button-icon" data-delete-rule aria-label="Excluir ${rule.name}">${icon('trash', 16)}</button>`
            : ''
        }
      </div>
    </div>
    <p class="rule-when">${describeTrigger(rule.trigger, names)}${rule.conditions.length ? html` <span class="muted">· com ${rule.conditions.length} ${rule.conditions.length === 1 ? 'condição' : 'condições'}</span>` : ''}</p>
    <ol class="rule-then">${rule.actions.map((action) => html`<li>${describeAction(action, names)}</li>`)}</ol>
    <p class="intake-card-meta">Criada por ${rule.owner.name} · as mudanças aparecem no histórico como <strong>Automação</strong></p>
    <div class="rule-runs" data-runs-list hidden></div>
  </li>
`

/**
 * The space's automations (escopo-mvp 4.2): each rule read as a sentence, its recent runs, and — for
 * the space's admins — switching it, editing and removing it.
 */
export const automationsPanel = async (spaceId: string, manages: boolean): Promise<Html> => {
  const [rules, context] = await Promise.all([intakeRead.automations(spaceId), loadContext(spaceId)])
  const names = namesOf(context)
  return html`
    <section class="section">
      <div class="section-head">
        <div>
          <h2>Automações</h2>
          <p class="muted">Quando algo acontece com um card deste espaço, a regra faz o resto — em até um minuto.</p>
        </div>
        ${manages ? html`<button type="button" class="button button-primary" data-new-rule>${icon('plus', 16)}Nova automação</button>` : ''}
      </div>
      ${
        rules.items.length
          ? html`<ul class="intake-list">${rules.items.map((rule) => ruleCard(rule, names, manages))}</ul>`
          : html`<div class="empty"><p class="empty-title">Nenhuma automação ainda</p><p class="muted">Por exemplo: quando um pedido é priorizado, criar a oportunidade no Discovery e avisar no Slack.</p></div>`
      }
    </section>
  `
}

const runItem = (run: Run): Html => html`
  <li class="run run-${run.status}">
    <span class="run-status">${RUN_STATUS_LABEL[run.status]}</span>
    <span class="muted">${WHEN.format(new Date(run.occurredAt))}</span>
    <span>${run.steps.map(stepLabel).join(' · ')}</span>
    ${run.error ? html`<code class="run-error">${run.error}</code>` : ''}
  </li>
`

const _toggleRuns = async (card: HTMLElement, button: HTMLElement, ruleId: string) => {
  const list = card.querySelector('[data-runs-list]') as HTMLElement
  const open = list.hidden
  button.setAttribute('aria-expanded', String(open))
  list.hidden = !open
  if (open) {
    const runs = (await intakeRead.runs(ruleId)).items
    list.innerHTML = (
      runs.length ? html`<ul class="run-list">${runs.map(runItem)}</ul>` : html`<p class="muted">Ainda não rodou.</p>`
    ).value
  }
}

const _act = async (target: HTMLElement, spaceId: string) => {
  const card = target.closest<HTMLElement>('[data-rule]')
  const rule = (await intakeRead.automations(spaceId)).items.find((each) => each.id === card?.dataset.rule)
  if (!card || !rule) {
    return
  }
  const runs = target.closest<HTMLElement>('[data-runs]')
  if (runs) {
    await _toggleRuns(card, runs, rule.id)
  } else if (target.closest('[data-toggle-rule]')) {
    await intakeWrite.updateAutomation(rule.id, spaceId, { ...payload(draftOf(spaceId, rule)), enabled: !rule.enabled })
  } else if (target.closest('[data-edit-rule]')) {
    openAutomationEditor(await loadContext(spaceId), rule)
  } else if (target.closest('[data-delete-rule]')) {
    openFormDialog({
      title: `Excluir ${rule.name}`,
      submit: 'Excluir automação',
      done: 'Automação excluída.',
      fields: html`<p class="muted">A regra para de rodar e suas execuções somem. O que ela já fez nos cards fica.</p>`,
      onSubmit: () => intakeWrite.deleteAutomation(rule.id, spaceId)
    })
  }
}

export const bindAutomationsPanel = (root: HTMLElement, spaceId: string): void => {
  const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
  root.querySelector('[data-new-rule]')?.addEventListener('click', () => {
    void loadContext(spaceId)
      .then((context) => openAutomationEditor(context))
      .catch(refuse)
  })
  root.querySelector('.intake-list')?.addEventListener('click', (event) => {
    void _act(event.target as HTMLElement, spaceId).catch(refuse)
  })
}
