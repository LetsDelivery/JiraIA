import { defineRoute, type Route } from '@jiraia/http'

import { cardPathSchema } from '../cards/schemas.js'
import { cardStarSchema, myCardListSchema, myCardsQuerySchema } from './my-cards.schemas.js'
import type { MyCardsService } from './my-cards.service.js'

/** "Suas tarefas" on Para você, and the stars on a card one of its tabs is made of. */
export const myCardRoutes = (myCards: MyCardsService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/me/cards',
    requires: 'authenticated',
    schemas: { query: myCardsQuerySchema },
    responds: myCardListSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await myCards.list(caller, query.tab) })
  }),
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/star',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: cardStarSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await myCards.starred(caller, path.cardId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/cards/{cardId}/star',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: cardStarSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await myCards.star(caller, path.cardId, true) })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/cards/{cardId}/star',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: cardStarSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await myCards.star(caller, path.cardId, false) })
  })
]
