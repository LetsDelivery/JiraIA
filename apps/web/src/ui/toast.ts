import { html } from '@/lib/html'

const DURATION_MS = 4000

/** A short message in the corner, read out by screen readers (`#toasts` is a live region). */
export const toast = (message: string, tone: 'success' | 'error' = 'success'): void => {
  const region = document.getElementById('toasts')
  if (!region) {
    return
  }

  const item = document.createElement('div')
  item.className = `toast glass toast-${tone}`
  item.innerHTML = html`${message}`.value
  region.append(item)
  setTimeout(() => item.remove(), DURATION_MS)
}
