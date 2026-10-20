/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_ALLOWED_EMAIL_DOMAIN?: string
  readonly VITE_API_BASE?: string
  readonly VITE_LOCAL_AUTH?: string
}
