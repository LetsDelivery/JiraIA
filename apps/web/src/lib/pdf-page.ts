import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * The first page of a PDF as a picture, drawn in the browser by pdf.js (Apache-2.0) — the only place
 * the panel touches it. Import this module with `import()`: pdf.js is heavy, and only a card with a
 * PDF needs it.
 *
 * @example const picture = await firstPage(attachment.previewUrl, 320)   // 'data:image/webp;base64,…'
 */
export const firstPage = async (url: string, width: number): Promise<string> => {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  // One plain GET: the bucket's CORS rule lets no `Range` header through.
  const loading = pdfjs.getDocument({ url, disableRange: true, disableStream: true })
  try {
    const document = await loading.promise
    const page = await document.getPage(1)
    const scale = (width * Math.min(window.devicePixelRatio, 2)) / page.getViewport({ scale: 1 }).width
    const viewport = page.getViewport({ scale })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    return canvas.toDataURL('image/webp', 0.8)
  } finally {
    await loading.destroy()
  }
}
