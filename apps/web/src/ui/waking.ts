import { html } from '@/lib/html'

import type { WaitingNotice } from '../api/resume'

/**
 * One notice in the corner however many requests wait for the database (ADR-0035): up with the
 * first, down with the last. `#toasts` is a live region, so a screen reader hears it once.
 */
export const wakingNotice = (): WaitingNotice => {
  let waiting = 0
  let item: HTMLElement | undefined
  return {
    begin: () => {
      waiting += 1
      item ??= _show()
      let ended = false
      return {
        end: () => {
          if (ended) {
            return
          }
          ended = true
          waiting -= 1
          if (waiting === 0) {
            item?.remove()
            item = undefined
          }
        }
      }
    }
  }
}

const _show = (): HTMLElement | undefined => {
  const region = document.getElementById('toasts')
  if (!region) {
    return undefined
  }
  const item = document.createElement('div')
  item.className = 'toast glass waking'
  item.innerHTML =
    html`<span class="waking-spinner" aria-hidden="true"></span>Carregando seus dados… depois de um tempo sem uso, leva alguns segundos.`.value
  region.append(item)
  return item
}
