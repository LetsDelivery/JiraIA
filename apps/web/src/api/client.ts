import createClient, { type Middleware } from 'openapi-fetch'

import { freshSession, session, signOut } from '@/auth/session'
import { wakingNotice } from '@/ui/waking'

import { resumingFetch } from './resume'
import type { paths } from './schema'
import { Warmer } from './warm'

/**
 * The one way this app talks to the API, typed from the contract (`bun run api:types`).
 *
 * The Cognito ID token of a Google sign-in goes as the bearer, renewed before it lapses; the API
 * verifies it against the user pool (ADR-0026).
 *
 * `x-local-user` is sent beside the bearer token in `dev`: the local harness authenticates by that
 * header and ignores the token. `VITE_LOCAL_AUTH=0` turns it off, for pointing `dev` at a deployed API.
 */
const LOCAL_AUTH = (import.meta.env.VITE_LOCAL_AUTH ?? (import.meta.env.DEV ? '1' : '0')) === '1'

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

const authenticate: Middleware = {
  onRequest: async ({ request }) => {
    const current = await freshSession()
    if (current?.token) {
      request.headers.set('authorization', `Bearer ${current.token}`)
    }
    if (current && LOCAL_AUTH) {
      request.headers.set('x-local-user', current.email)
    }
    return request
  },
  onResponse: ({ response }) => {
    warmer.heard()
    // A token the API no longer accepts ends the session; the app then shows the sign-in screen.
    if (response.status === 401 && session.get()) {
      signOut()
    }
    return response
  }
}

// A paused database answers 503 while it resumes; the request is asked again under a notice (ADR-0035).
export const api = createClient<paths>({
  baseUrl: API_BASE,
  fetch: resumingFetch((request) => fetch(request), wakingNotice())
})
api.use(authenticate)

/**
 * Wakes a paused database ahead of the person's first click (ADR-0035): `GET /work/me`, sent without
 * the notice or the retries, its answer thrown away.
 */
const quiet = createClient<paths>({ baseUrl: API_BASE, fetch: (request) => fetch(request) })
quiet.use(authenticate)
export const warmer = new Warmer(async () => (session.get() ? await quiet.GET('/work/me') : undefined))

export type ApiError = { error: { code: string; message: string; details?: Record<string, unknown> } }
