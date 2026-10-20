import { defineRoute, type Route } from '@jiraia/http'

import { spacePathSchema } from '../spaces/schemas.js'
import type { DashboardService } from './dashboard.service.js'
import type { ReportService } from './report.service.js'
import { dashboardSchema, reportSchema, runReportSchema, saveDashboardSchema } from './schemas.js'

/** A space's dashboard and its widgets' data (Etapa 5d, ADR-0016). */
export const reportRoutes = (dashboards: DashboardService, reports: ReportService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/dashboard',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: dashboardSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await dashboards.read(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/spaces/{spaceId}/dashboard',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: saveDashboardSchema },
    responds: dashboardSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await dashboards.save(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/spaces/{spaceId}/dashboard',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: dashboardSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await dashboards.restore(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/reports/run',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: runReportSchema },
    responds: reportSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await reports.run(caller, path.spaceId, body)
    })
  })
]
