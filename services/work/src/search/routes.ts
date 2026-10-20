import { defineRoute, type Route } from '@jiraia/http'

import type { BulkEditService } from '../cards/bulk.service.js'
import { bulkEditSchema, cardListSchema } from '../cards/schemas.js'
import {
  cardSearchResultSchema,
  cardSearchSchema,
  textSearchQuerySchema,
  textSearchResultSchema
} from './filter.schemas.js'
import type { SearchService } from './search.service.js'

/** Finding cards (3.4, 3.6) and changing many at once (3.8). */
export const searchRoutes = (search: SearchService, bulk: BulkEditService): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/cards/search',
    requires: 'authenticated',
    schemas: { body: cardSearchSchema },
    responds: cardSearchResultSchema,
    handler: async ({ caller, body }) => ({ statusCode: 200, body: await search.cards(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/search',
    requires: 'authenticated',
    schemas: { query: textSearchQuerySchema },
    responds: textSearchResultSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await search.text(caller, query.q, query.limit) })
  }),
  defineRoute({
    method: 'POST',
    path: '/cards/bulk',
    requires: 'authenticated',
    schemas: { body: bulkEditSchema },
    responds: cardListSchema,
    handler: async ({ caller, body }) => ({ statusCode: 200, body: await bulk.edit(caller, body) })
  })
]
