/**
 * A profile photo as the panel sends it (ADR-0039): the centre square of the picture chosen, scaled
 * down to `AVATAR_SIZE` — a few kilobytes, whatever the camera took.
 */
export const AVATAR_SIZE = 256

type Square = { x: number; y: number; side: number }

/** The largest square in the middle of a `width` × `height` picture. */
export const centreSquare = (width: number, height: number): Square => {
  const side = Math.min(width, height)
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side }
}

/** The type the API accepts that this browser encoded: WebP where it can, JPEG elsewhere. */
export const avatarType = (encoded: string): 'image/webp' | 'image/jpeg' | 'image/png' =>
  encoded === 'image/webp' || encoded === 'image/png' ? encoded : 'image/jpeg'

const encode = (canvas: HTMLCanvasElement, type: string): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, 0.85))

/** Crops and scales the file in the browser; refuses what it cannot read as a picture. */
export const toAvatar = async (file: Blob): Promise<Blob> => {
  const picture = await createImageBitmap(file)
  const { x, y, side } = centreSquare(picture.width, picture.height)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  canvas.getContext('2d')?.drawImage(picture, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  picture.close()
  const blob = (await encode(canvas, 'image/webp')) ?? (await encode(canvas, 'image/jpeg'))
  if (!blob) {
    throw new Error('The photo could not be encoded')
  }
  return blob
}
