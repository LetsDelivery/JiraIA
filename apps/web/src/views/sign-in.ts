import { api } from '@/api/client'
import { type Session, signIn } from '@/auth/session'
import { ALLOWED_DOMAIN, GOOGLE_CLIENT_ID, googleIdentity, readIdToken } from '@/lib/google'
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
  toast(refused ? `Só contas Google @${ALLOWED_DOMAIN} podem entrar no JiraIA.` : refusalSentence(error), 'error')
}

const googleSignIn = html`<div class="google-button" data-google-button></div>`

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
      <p class="muted">Use sua conta Google @${ALLOWED_DOMAIN}.</p>
      ${GOOGLE_CLIENT_ID ? googleSignIn : import.meta.env.DEV ? localSignIn : html`<p class="muted">Login indisponível: falta configurar o Google.</p>`}
    </section>
  </main>
`

const bindGoogle = async (container: HTMLElement, clientId: string): Promise<void> => {
  const identity = await googleIdentity()
  identity.initialize({
    client_id: clientId,
    // A hint that narrows Google's account chooser. The API is what enforces the domain.
    hd: ALLOWED_DOMAIN,
    auto_select: true,
    callback: ({ credential }) => void complete({ ...readIdToken(credential), token: credential })
  })
  identity.renderButton(container, {
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    locale: 'pt-BR'
  })
  identity.prompt()
}

export const bindSignIn = (root: HTMLElement): void => {
  const google = root.querySelector<HTMLElement>('[data-google-button]')
  if (google && GOOGLE_CLIENT_ID) {
    bindGoogle(google, GOOGLE_CLIENT_ID).catch(() =>
      toast('Não foi possível carregar o login do Google. Recarregue a página.', 'error')
    )
  }
  root.querySelector<HTMLFormElement>('[data-local-sign-in]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const email = String(new FormData(event.target as HTMLFormElement).get('email') ?? '')
      .trim()
      .toLowerCase()
    void complete({ email, token: '', expiresAt: Date.now() + 12 * 60 * 60 * 1000 })
  })
}
