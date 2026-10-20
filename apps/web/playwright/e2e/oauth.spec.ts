import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

/**
 * Etapa 6c through the screens (ADR-0021): an application sends a signed-out person to the consent
 * page; they sign in, land back on it, allow, and are sent back to the application with a code that
 * becomes a token for MCP, which writes as them, "via" the application. Their profile lists the
 * application, and disconnecting ends the token.
 */
const API = 'http://localhost:8290/work'
const REDIRECT = 'http://localhost:33418/callback'

test('a person allows an application, which then reaches MCP until they disconnect it', async ({ page }) => {
  const client = (await (
    await page.request.post(`${API}/oauth/register`, {
      data: { client_name: 'Minha Plataforma', redirect_uris: [REDIRECT] }
    })
  ).json()) as { client_id: string }
  const verifier = `verifier-${'x'.repeat(48)}`
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const consent = `/oauth/autorizar?${new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'abc'
  })}`
  let sentBack: URL | undefined
  await page.route('http://localhost:33418/**', async (route) => {
    sentBack = new URL(route.request().url())
    await route.fulfill({ body: 'ok' })
  })

  await page.goto(consent)
  await page.getByLabel('E-mail').fill('ana@uselets.com')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: /Minha Plataforma quer acessar o JiraIA/ })).toBeVisible()
  await expect(page.locator('[data-consent]')).toContainText('localhost:33418')
  await page.getByRole('button', { name: 'Permitir' }).click()
  await expect.poll(() => sentBack?.searchParams.get('state')).toBe('abc')

  const tokens = (await (
    await page.request.post(`${API}/oauth/token`, {
      form: {
        grant_type: 'authorization_code',
        code: sentBack?.searchParams.get('code') ?? '',
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: REDIRECT
      }
    })
  ).json()) as { access_token: string }
  const ping = () =>
    page.request.post(`${API}/v1/mcp`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      data: { jsonrpc: '2.0', id: 1, method: 'ping' }
    })
  expect((await ping()).status()).toBe(200)

  // It writes as Ana, at once, and the card's history says it came through the application.
  const comment = await page.request.post(`${API}/v1/mcp`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    data: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'comment_on_card', arguments: { card: 'PRD-6', body: 'Escrito pela Laís' } }
    }
  })
  expect(((await comment.json()) as { result: { isError: boolean } }).result.isError).toBe(false)
  await page.goto('/espacos/PRD?card=PRD-6')
  await expect(page.getByText('Escrito pela Laís')).toBeVisible()
  await page.getByRole('tab', { name: 'Tudo' }).click()
  await expect(page.locator('.history-via').first()).toHaveText('via Minha Plataforma')

  await page.goto('/perfil')
  const row = page.locator('[data-connection]').filter({ hasText: 'Minha Plataforma' })
  await row.getByRole('button', { name: 'Desconectar' }).click()
  await expect(page.getByText('Aplicativo desconectado.')).toBeVisible()
  expect((await ping()).status()).toBe(401)
})

test('a consent request for an address the application did not register is refused', async ({ page }) => {
  const client = (await (
    await page.request.post(`${API}/oauth/register`, {
      data: { client_name: 'Outra', redirect_uris: [REDIRECT] }
    })
  ).json()) as { client_id: string }
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill('ana@uselets.com')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Para você' })).toBeVisible()
  await page.goto(
    `/oauth/autorizar?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256`
  )
  await expect(page.getByRole('heading', { name: 'Não foi possível conectar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0)
})
