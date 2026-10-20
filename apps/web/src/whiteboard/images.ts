import { refusalSentence } from '@/lib/refusal'
import { toast } from '@/ui/toast'

import { newImage } from './elements'
import type { Vec } from './geometry'
import type { Whiteboard } from './whiteboard'

/**
 * Images on a whiteboard (Etapa 4d-c, ADR-0017). The bytes go where a page's images go — the content's
 * files, in storage — and the element keeps only the file's id. Addresses to read a file expire, so they
 * are asked for when the board is drawn and kept for the visit.
 */
export type BoardFiles = {
  upload: (file: File) => Promise<string>
  url: (fileId: string) => Promise<string>
}

/** The biggest side an image is placed with; it can be resized after. */
const LARGEST = 480

export class ImageUrls {
  private readonly known = new Map<string, string>()
  private readonly asked = new Set<string>()

  constructor(
    private readonly files: BoardFiles | undefined,
    private readonly ready: () => void
  ) {}

  /** The address to draw a file with, if it is known; asked for once, and drawn again when it arrives. */
  get(fileId: string | null): string | undefined {
    if (!fileId || !this.files) {
      return undefined
    }
    const known = this.known.get(fileId)
    if (known === undefined && !this.asked.has(fileId)) {
      this.asked.add(fileId)
      void this.files.url(fileId).then((url) => {
        this.known.set(fileId, url)
        this.ready()
      })
    }
    return known
  }

  /** A file just sent can be shown from this browser right away. */
  remember(fileId: string, url: string): void {
    this.known.set(fileId, url)
    this.asked.add(fileId)
  }
}

const sizeOf = async (file: File): Promise<{ width: number; height: number }> => {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, LARGEST / Math.max(bitmap.width, bitmap.height))
  const size = { width: bitmap.width * scale, height: bitmap.height * scale }
  bitmap.close()
  return size
}

/** Images put on the board, side by side, centred on `at`; the new ones are selected. */
export const insertImages = async (board: Whiteboard, files: readonly File[], at: Vec): Promise<void> => {
  const images = files.filter((file) => file.type.startsWith('image/'))
  if (!board.editable || !board.files || !images.length) {
    return
  }
  let x = at.x
  const placed: string[] = []
  for (const file of images) {
    const size = await sizeOf(file).catch(() => undefined)
    if (!size) {
      toast(`Não foi possível ler ${file.name}.`, 'error')
      continue
    }
    const fileId = await board.files.upload(file)
    board.images.remember(fileId, URL.createObjectURL(file))
    const image = newImage({ x: x - size.width / 2, y: at.y - size.height / 2, ...size }, '', fileId, board.scene.top)
    board.scene.step(() => board.scene.put(image))
    placed.push(image.id)
    x += size.width + 16
  }
  board.select(placed)
}

/** The file picker for the image tool; the images land in the middle of what is on screen. */
export const pickImages = (board: Whiteboard): void => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.addEventListener('change', () => {
    void insertImages(board, [...(input.files ?? [])], board.center()).catch((refusal: unknown) =>
      toast(refusalSentence(refusal), 'error')
    )
  })
  input.click()
}
