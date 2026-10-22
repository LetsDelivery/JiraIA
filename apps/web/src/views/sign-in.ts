import { api } from '@/api/client'
import { type Session, signIn } from '@/auth/session'
import {
  ALLOWED_DOMAINS,
  COGNITO,
  type Cognito,
  domainsSentence,
  finishSignIn,
  RETURN_PATH,
  signInError,
  startSignIn
} from '@/lib/cognito'
import { html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { textField } from '@/ui/dialog'
import { toast } from '@/ui/toast'

const LOCAL_AUTH = (import.meta.env.VITE_LOCAL_AUTH ?? (import.meta.env.DEV ? '1' : '0')) === '1'

/**
 * Asks the API who this is before keeping the session: the API applies the domain rule (ADR-0005),
 * and a refusal belongs on this screen, with a sentence — never as a flash of the app and a bounce.
 */
const complete = async (value: Session): Promise<void> => {
  const headers: Record<string, string> = {
    ...(value.token ? { authorization: `Bearer ${value.token}` } : {}),
    ...(LOCAL_AUTH ? { 'x-local-user': value.email } : {})
  }
  const { error } = await api.GET('/work/me', { headers })

  if (!error) {
    signIn(value)
    return
  }
  const refused = (error as { error?: { code?: string } }).error?.code === 'FORBIDDEN'
  toast(
    refused ? `Só contas Google ${domainsSentence(ALLOWED_DOMAINS)} podem entrar no JiraIA.` : refusalSentence(error),
    'error'
  )
}

/** Through the user pool, straight to Google and back here with a code (ADR-0026). */
const googleSignIn = html`<button type="button" class="button button-primary" data-google-sign-in>Entrar com Google</button>`

/** Local development only: there is no Google, so an address stands in for it (`x-local-user`). */
const localSignIn = html`
  <form class="stack" data-local-sign-in>
    ${textField({ name: 'email', label: 'E-mail', type: 'email', required: true, hint: 'Ambiente local, sem Google: entra direto como este e-mail.' })}
    <button type="submit" class="button button-primary">Entrar</button>
  </form>
`

export const signInPage = () => html`
  <main class="sign-in">
    <section class="sign-in-card glass" aria-labelledby="sign-in-title">
      <p class="brand">Jira<span>IA</span></p>
      <h1 id="sign-in-title">Entrar no JiraIA</h1>
      <p class="muted">Use sua conta Google ${domainsSentence(ALLOWED_DOMAINS)}.</p>
      ${COGNITO ? googleSignIn : import.meta.env.DEV ? localSignIn : html`<p class="muted">Login indisponível: falta configurar o Google.</p>`}
    </section>
  </main>
`

/** Back from Google with a code: the tokens it stands for, then the same check as every sign-in. */
const finishGoogle = async (cognito: Cognito): Promise<void> => {
  const refused = signInError(location.search)
  if (refused) {
    history.replaceState(null, '', RETURN_PATH)
    toast(`O login com o Google não foi concluído: ${refused}`, 'error')
    return
  }
  const tokens = await finishSignIn(cognito, location.search)
  if (!tokens) {
    return
  }
  // The code is spent: keep it out of the address bar and of a reload.
  history.replaceState(null, '', RETURN_PATH)
  await complete(tokens)
}

export const bindSignIn = (root: HTMLElement): void => {
  if (COGNITO) {
    const cognito = COGNITO
    finishGoogle(cognito).catch(() => toast('Não foi possível concluir o login com o Google. Tente de novo.', 'error'))
    root.querySelector('[data-google-sign-in]')?.addEventListener('click', () => {
      startSignIn(cognito).catch(() => toast('Não foi possível abrir o login do Google. Recarregue a página.', 'error'))
    })
  }
  root.querySelector<HTMLFormElement>('[data-local-sign-in]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const email = String(new FormData(event.target as HTMLFormElement).get('email') ?? '')
      .trim()
      .toLowerCase()
    void complete({ email, token: '', expiresAt: Date.now() + 12 * 60 * 60 * 1000 })
  })
}
