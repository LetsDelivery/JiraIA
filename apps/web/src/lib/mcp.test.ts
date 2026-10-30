import { describe, expect, it } from 'vitest'

import {
  assistantOf,
  claudeCodeCommand,
  connectionsByAssistant,
  cursorInstallLink,
  mcpUrl,
  vscodeInstallLink
} from './mcp'

const URL_ = 'https://jiraia.uselets.com/api/work/v1/mcp'

describe('mcpUrl', () => {
  it('puts the endpoint under the panel’s API base', () => {
    expect(mcpUrl('https://jiraia.uselets.com', '/api')).toBe(URL_)
  })

  it('keeps an absolute API base', () => {
    expect(mcpUrl('http://localhost:5280', 'https://dev-jiraia.uselets.com/api')).toBe(
      'https://dev-jiraia.uselets.com/api/work/v1/mcp'
    )
  })
})

describe('install links', () => {
  it('builds the Claude Code command', () => {
    expect(claudeCodeCommand(URL_)).toBe(`claude mcp add --transport http jiraia ${URL_}`)
  })

  it('carries the address in Cursor’s base64 configuration', () => {
    const config = new URL(cursorInstallLink(URL_)).searchParams.get('config') ?? ''
    expect(JSON.parse(atob(config))).toEqual({ url: URL_ })
  })

  it('carries the address in VS Code’s JSON configuration', () => {
    const link = vscodeInstallLink(URL_)
    expect(link.startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(link.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'jiraia',
      type: 'http',
      url: URL_
    })
  })
})

describe('assistantOf', () => {
  it('knows each assistant by the name it registered or where it sends people back', () => {
    expect(assistantOf({ name: 'Claude', redirectHost: 'claude.ai' })).toBe('claude')
    expect(assistantOf({ name: 'Anthropic', redirectHost: 'claude.com' })).toBe('claude')
    expect(assistantOf({ name: 'Claude Code (jiraia)', redirectHost: 'localhost:51234' })).toBe('claudeCode')
    expect(assistantOf({ name: 'Cursor', redirectHost: 'localhost:3000' })).toBe('cursor')
    expect(assistantOf({ name: 'Visual Studio Code', redirectHost: 'vscode.dev' })).toBe('vscode')
    expect(assistantOf({ name: 'Laís', redirectHost: 'lais.uselets.com' })).toBe('lais')
    expect(assistantOf({ name: 'Lais', redirectHost: 'lais.uselets.com' })).toBe('lais')
  })

  it('leaves an application it does not list alone', () => {
    expect(assistantOf({ name: 'Minha Plataforma', redirectHost: 'example.com' })).toBeUndefined()
    expect(assistantOf({ name: 'Palais', redirectHost: 'example.com' })).toBeUndefined()
    expect(assistantOf({ name: 'Claudette', redirectHost: 'evilclaude.ai' })).toBeUndefined()
  })
})

describe('connectionsByAssistant', () => {
  it('groups the person’s connections and drops the ones it does not list', () => {
    const connection = (id: string, name: string, redirectHost: string) => ({ id, application: { name, redirectHost } })
    const groups = connectionsByAssistant([
      connection('1', 'Claude', 'claude.ai'),
      connection('2', 'Claude Code', 'localhost:1'),
      connection('3', 'Claude Code', 'localhost:2'),
      connection('4', 'Outro', 'example.com')
    ])
    expect(groups.claude?.map((each) => each.id)).toEqual(['1'])
    expect(groups.claudeCode?.map((each) => each.id)).toEqual(['2', '3'])
    expect(groups.cursor).toBeUndefined()
  })
})
