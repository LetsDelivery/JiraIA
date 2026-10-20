import { defineRoute, type Route } from '@jiraia/http'

import { spacePathSchema } from '../spaces/schemas.js'
import type { FormService } from './form.service.js'
import {
  formInputSchema,
  formListSchema,
  formPathSchema,
  formViewSchema,
  submissionResultSchema,
  submissionSchema
} from './schemas.js'

export const formRoutes = (forms: FormService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/forms',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: formListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await forms.list(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/forms',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: formInputSchema },
    responds: formViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await forms.create(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/forms/{formId}',
    requires: 'authenticated',
    schemas: { path: formPathSchema },
    responds: formViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await forms.read(caller, path.formId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/forms/{formId}',
    requires: 'authenticated',
    schemas: { path: formPathSchema, body: formInputSchema },
    responds: formViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await forms.update(caller, path.formId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/forms/{formId}',
    requires: 'authenticated',
    schemas: { path: formPathSchema },
    responds: formListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await forms.remove(caller, path.formId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/forms/{formId}/submissions',
    requires: 'authenticated',
    schemas: { path: formPathSchema, body: submissionSchema },
    responds: submissionResultSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await forms.submit(caller, path.formId, body.answers)
    })
  })
]
