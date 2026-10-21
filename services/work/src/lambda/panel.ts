import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

/**
 * The panel's files, put where CloudFront serves them from (ADR-0025).
 *
 * The panel's build travels inside the function's package (`infra/build`), so one artifact carries
 * the API and the panel that speaks to it, and the deploy of each account publishes both together.
 */
export type PanelBucket = {
  put(object: { key: string; body: Uint8Array; contentType: string; cacheControl: string }): Promise<void>
}

export class S3PanelBucket implements PanelBucket {
  private readonly s3: S3Client

  constructor(private readonly config: { bucket: string; region: string }) {
    this.s3 = new S3Client({ region: config.region })
  }

  async put(object: { key: string; body: Uint8Array; contentType: string; cacheControl: string }): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: object.key,
        Body: object.body,
        ContentType: object.contentType,
        CacheControl: object.cacheControl
      })
    )
  }
}

export class InMemoryPanelBucket implements PanelBucket {
  readonly objects = new Map<string, { body: string; contentType: string; cacheControl: string }>()

  async put(object: { key: string; body: Uint8Array; contentType: string; cacheControl: string }): Promise<void> {
    const { contentType, cacheControl } = object
    this.objects.set(object.key, { body: new TextDecoder().decode(object.body), contentType, cacheControl })
  }
}

/**
 * What the panel learns at run time rather than at build time: it differs per account. Where to send a
 * person to sign in (the user pool's hosted sign-in and the panel's app client, ADR-0026), and the
 * domains the sign-in screen names.
 */
export type PanelSettings = {
  cognitoDomain: string
  cognitoClientId: string
  allowedEmailDomains: readonly string[]
}

/** The file the panel reads its settings from (`apps/web/index.html`); written last, by the deploy. */
export const SETTINGS_FILE = 'config.js'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
}

/**
 * Vite names everything under `assets/` by its content hash, so a cached copy can never be stale;
 * everything else is revalidated on every load, which is how a new deploy reaches open browsers.
 */
const _cacheControl = (key: string): string =>
  key.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'

const _object = (key: string, body: Uint8Array) => ({
  key,
  body,
  contentType: TYPES[extname(key)] ?? 'application/octet-stream',
  cacheControl: _cacheControl(key)
})

/** Every file under `dir`, as keys relative to it with `/` separators. */
const _keys = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(dir.length + 1)
        .replaceAll('\\', '/')
    )
    .sort()
}

/**
 * Puts the built panel in the bucket, then its settings. Old hashed assets stay: a browser that
 * loaded the previous `index.html` still finds the files it names.
 *
 * @example await publishPanel('/var/task/panel', bucket, { cognitoDomain, cognitoClientId, allowedEmailDomains })   // 27
 */
export const publishPanel = async (dir: string, bucket: PanelBucket, settings: PanelSettings): Promise<number> => {
  const keys = (await _keys(dir)).filter((key) => key !== SETTINGS_FILE)
  if (!keys.includes('index.html')) {
    throw new Error(`The panel at "${dir}" has no index.html; was it built before packaging?`)
  }
  for (const key of keys) {
    await bucket.put(_object(key, await readFile(join(dir, key))))
  }
  const script = `globalThis.JIRAIA_CONFIG = ${JSON.stringify(settings)}\n`
  await bucket.put(_object(SETTINGS_FILE, new TextEncoder().encode(script)))
  return keys.length + 1
}
