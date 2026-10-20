import createClient, { type Middleware } from 'openapi-fetch'

import { session, signOut } from '@/auth/session'

import type { paths } from './schema'

/**
 * The one way this app talks to the API, typed from the contract (`bun run api:types`).
 *
 * The Google ID token goes as the bearer; API Gateway verifies it against Google (ADR-0005).
 *
 * `x-local-user` is sent beside the bearer token in `dev`: the local harness authenticates by that
 * header and ignores the token. `VITE_LOCAL_AUTH=0` turns it off, for pointing `dev` at a deployed API.
 */
const LOCAL_AUTH = (import.meta.env.VITE_LOCAL_AUTH ?? (import.meta.env.DEV ? '1' : '0')) === '1'

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

const authenticate: Middleware = {
  onRequest: ({ request }) => {
    const current = session.get()
    if (current?.token) {
      request.headers.set('authorization', `Bearer ${current.token}`)
    }
    if (current && LOCAL_AUTH) {
      request.headers.set('x-local-user', current.email)
    }
    return request
  },
  onResponse: ({ response }) => {
    // A token the API no longer accepts (a Google ID token lives one hour) ends the session; the app
    // then shows the sign-in screen, where One Tap usually signs the person straight back in.
    if (response.status === 401 && session.get()) {
      signOut()
    }
    return response
  }
}

export const api = createClient<paths>({ baseUrl: API_BASE, fetch: (request) => fetch(request) })
api.use(authenticate)

export type ApiError = { error: { code: string; message: string; details?: Record<string, unknown> } }
