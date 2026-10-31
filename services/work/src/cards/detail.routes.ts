import { defineRoute, type Route } from '@jiraia/http'

import { type CardDetailService, cardDetailSchema } from './detail.service.js'
import { cardPathSchema } from './schemas.js'

/** The opened card's page in one request (ADR-0041). */
export const cardDetailRoutes = (detail: CardDetailService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/detail',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: cardDetailSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await detail.read(caller, path.cardId) })
  })
]
