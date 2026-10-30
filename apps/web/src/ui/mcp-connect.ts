import vscode from '@tabler/icons/outline/brand-vscode.svg?raw'

import { API_BASE } from '@/api/client'
import { type Connection, oauthWrite } from '@/api/oauth'
import claude from '@/assets/brands/claude.svg?raw'
import claudeCode from '@/assets/brands/claude-code.svg?raw'
import cursor from '@/assets/brands/cursor.svg?raw'
import laisLogo from '@/assets/lais.png'
import { type Html, html, raw } from '@/lib/html'
import {
  ASSISTANTS,
  type Assistant,
  claudeCodeCommand,
  connectionsByAssistant,
  cursorInstallLink,
  mcpUrl,
  vscodeInstallLink
} from '@/lib/mcp'
import { refusalSentence } from '@/lib/refusal'
import { busy } from '@/ui/busy'

import { icon } from './icons'
import { toast } from './toast'

const copyBox = (value: string, label: string): Html => html`
  <div class="secret-box">
    <code class="secret-value">${value}</code>
    <button type="button" class="button button-secondary button-small" data-copy="${value}" aria-label="Copiar ${label}">${icon('copy', 16)}Copiar</button>
  </div>
`

/**
 * The assistants' logos, in one colour like the rest of the panel. Claude, Claude Code and Cursor come
 * from Simple Icons (CC0-1.0); VS Code from Tabler (MIT); the Laís logo is LET'S own.
 */
const LOGOS = { claude, claudeCode, cursor, vscode }

const logo = (name: keyof typeof LOGOS): Html =>
  raw(LOGOS[name].replace('<svg', '<svg aria-hidden="true" focusable="false" class="assistant-logo"'))

const laisMark: Html = html`<img class="assistant-logo" src="${laisLogo}" alt="" width="28" height="28" />`

const installLink = (href: string, label: string): Html =>
  html`<a class="button button-secondary button-small" href="${href}">${icon('externalLink', 16)}${label}</a>`

/** Each assistant's name, logo and, when it has one, the shortcut that adds JiraIA to it. */
const ASSISTANT: Record<Assistant, { name: string; mark: Html; setup?: (url: string) => Html }> = {
  lais: { name: 'Laís', mark: laisMark },
  claude: { name: 'Claude Web', mark: logo('claude') },
  claudeCode: {
    name: 'Claude Code',
    mark: logo('claudeCode'),
    setup: (url) => copyBox(claudeCodeCommand(url), 'comando do Claude Code')
  },
  cursor: {
    name: 'Cursor',
    mark: logo('cursor'),
    setup: (url) => installLink(cursorInstallLink(url), 'Adicionar ao Cursor')
  },
  vscode: {
    name: 'VS Code',
    mark: logo('vscode'),
    setup: (url) => installLink(vscodeInstallLink(url), 'Adicionar ao VS Code')
  }
}

/** One assistant: logo and name, whether the person connected it, and disconnecting or the shortcut. */
const assistant = (which: Assistant, url: string, connections: readonly Connection[]): Html => {
  const { name, mark, setup } = ASSISTANT[which]
  const connected = connections.length > 0
  return html`
    <li class="assistant">
      <span class="assistant-mark">${mark}</span>
      <strong class="assistant-name">${name}</strong>
      ${connected ? html`<span class="badge badge-on">Conectado</span>` : html`<span class="muted assistant-state">Não conectado</span>`}
      ${
        connected
          ? html`<button type="button" class="button button-ghost button-small" data-disconnect-assistant="${connections.map((each) => each.id).join(' ')}" aria-label="Desconectar ${name}">Desconectar</button>`
          : (setup?.(url) ?? '')
      }
    </li>
  `
}

/**
 * Integrações → Conectar a um assistente (ADR-0021): the MCP address, and each assistant with whether
 * the person connected it. Connecting is OAuth — the person signs in with Google and allows; no API
 * token is made by hand.
 */
export const mcpConnectSection = (connections: readonly Connection[]): Html => {
  const url = mcpUrl(location.origin, API_BASE)
  const byAssistant = connectionsByAssistant(connections)
  return html`
    <section class="section">
      <div class="section-head">
        <div>
          <h2>Conectar a um assistente</h2>
          <p class="muted">Use o JiraIA no Claude, na Laís ou em qualquer assistente com MCP. O assistente lê e escreve como você, com o seu acesso — sem gerar token: você entra com a conta Google e permite. Os conectados ficam em <a class="link" href="/perfil">Meu perfil</a>.</p>
        </div>
      </div>
      ${copyBox(url, 'endereço do MCP')}
      <ul class="assistant-list">${ASSISTANTS.map((which) => assistant(which, url, byAssistant[which] ?? []))}</ul>
    </section>
  `
}

/** Ends every connection of one assistant: Claude Code, say, registers anew on each machine. */
const disconnect = (button: HTMLButtonElement): void => {
  const ids = (button.dataset.disconnectAssistant ?? '').split(' ').filter(Boolean)
  void busy(button, () => Promise.all(ids.map((id) => oauthWrite.revoke(id))))
    .then(() => toast('Assistente desconectado.'))
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
}

export const bindMcpConnect = (root: HTMLElement): void => {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-disconnect-assistant]')) {
    button.addEventListener('click', () => disconnect(button))
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', () => {
      const value = button.dataset.copy ?? ''
      void navigator.clipboard
        .writeText(value)
        .then(() => toast('Copiado.'))
        .catch(() => toast(`Não deu para copiar. O valor é ${value}`, 'error'))
    })
  }
}
