import type { HttpClient } from '@jiraia/http'
import type { JiraiaLogger } from '@jiraia/logger'
import { z } from 'zod'

/**
 * What CloudFormation asks of the stack's `Deploy` custom resource (ADR-0025).
 *
 * Its properties carry the artifact's version, so every deploy of new code updates it, and each
 * update applies the migrations and publishes the panel of the package being deployed. A failure
 * answers FAILED, and CloudFormation rolls the whole stack back.
 */
export const deployRequestSchema = z.object({
  RequestType: z.enum(['Create', 'Update', 'Delete']),
  ResponseURL: z.url(),
  StackId: z.string().min(1),
  RequestId: z.string().min(1),
  LogicalResourceId: z.string().min(1),
  PhysicalResourceId: z.string().optional()
})

export type DeployRequest = z.infer<typeof deployRequestSchema>

export type DeployDeps = {
  migrate(): Promise<void>
  publishPanel(): Promise<number>
  /** Where CloudFormation waits for the answer: a pre-signed S3 URL. */
  respond(url: string, body: string): Promise<void>
}

/** One resource, whatever the stack: replacing it would ask CloudFormation to delete the old one. */
const PHYSICAL_ID = 'jiraia-deploy'

/** CloudFormation shows `Reason` in the stack's events, and refuses an answer over 4 KB. */
/**
 * The error and what caused it: drizzle wraps the Data API's own error as the `cause` of a "Failed
 * query", which alone says nothing of why.
 *
 * @example describeError(new Error('Failed query: …', { cause: new Error('DatabaseResumingException') }))   // 'Error: Failed query: … — Error: DatabaseResumingException'
 */
export const describeError = (error: unknown): string => {
  const cause = error instanceof Error && error.cause !== undefined ? ` — ${String(error.cause)}` : ''
  return `${String(error)}${cause}`
}

const _reason = (error: unknown): string => describeError(error).slice(0, 1000)

const _answer = (request: DeployRequest, status: 'SUCCESS' | 'FAILED', extra: Record<string, unknown>) =>
  JSON.stringify({
    Status: status,
    PhysicalResourceId: PHYSICAL_ID,
    StackId: request.StackId,
    RequestId: request.RequestId,
    LogicalResourceId: request.LogicalResourceId,
    ...extra
  })

/** Delete does nothing: the schema and the panel outlive a resource that only applied them. */
const _run = async (deps: DeployDeps, request: DeployRequest): Promise<{ published: number }> => {
  if (request.RequestType === 'Delete') {
    return { published: 0 }
  }
  await deps.migrate()
  return { published: await deps.publishPanel() }
}

/**
 * Always answers: a custom resource that never answers holds the stack for an hour.
 *
 * @example await deploy(deps, logger, request)   // PUTs {"Status":"SUCCESS",…} to request.ResponseURL
 */
export const deploy = async (deps: DeployDeps, logger: JiraiaLogger, request: DeployRequest): Promise<void> => {
  try {
    const data = await _run(deps, request)
    logger.info('Deploy applied', { requestType: request.RequestType, ...data })
    await deps.respond(request.ResponseURL, _answer(request, 'SUCCESS', { Data: data }))
  } catch (error) {
    logger.error('Deploy failed', { requestType: request.RequestType, error: describeError(error) })
    await deps.respond(request.ResponseURL, _answer(request, 'FAILED', { Reason: _reason(error) }))
  }
}

/**
 * The answer as CloudFormation takes it: a PUT with no content type, which the URL was signed for.
 *
 * @example respond: cloudFormationResponder(createHttpClient({ provider: 'cloudformation', logger }))
 */
export const cloudFormationResponder =
  (http: HttpClient): DeployDeps['respond'] =>
  async (url, body) => {
    const response = await http.send({ method: 'PUT', url, body, headers: { 'content-type': '' } })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`CloudFormation refused the deploy answer with ${response.status}`)
    }
  }
