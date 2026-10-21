import { describe, expect, it } from 'bun:test'

import { buildDocument } from '../../../../infra/contracts/openapi.js'
import { buildService } from '../container.js'

/**
 * The contract reads route modules by name; a module it does not name is a set of routes the panel
 * never gets types for. Regression: the routes of 2.5–2.14 were left out until this test existed.
 */
describe('the OpenAPI contract', () => {
  it('describes every route the service mounts', async () => {
    const config = {
      DATABASE_URL: 'postgres://unused',
      AWS_REGION: 'us-east-1',
      ALLOWED_EMAIL_DOMAIN: 'uselets.com',
      ATTACHMENTS_BUCKET: 'unused',
      REALTIME_URL: 'ws://localhost/realtime'
    }
    const mounted = buildService(config).routes.map((route) => `${route.method} /work${route.path}`)
    const document = (await buildDocument()) as { paths: Record<string, Record<string, unknown>> }
    const described = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`)
    )

    expect(described.sort()).toEqual(mounted.sort())
  })

  // Regression: `/access-requests` and `/access/requests` both became `workPostAccessRequests`, and the
  // panel's generated types gave the second route the first one's body.
  it('names every operation once', async () => {
    const document = (await buildDocument()) as { paths: Record<string, Record<string, { operationId: string }>> }
    const ids = Object.values(document.paths).flatMap((methods) => Object.values(methods).map((op) => op.operationId))

    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })
})
