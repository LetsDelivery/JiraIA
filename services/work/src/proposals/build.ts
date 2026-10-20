import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { createLogger } from '@jiraia/logger'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { CardRepository } from '../cards/card.repository.js'
import type { CardService } from '../cards/card.service.js'
import type { CardGate } from '../cards/card-gate.js'
import type { CommentService } from '../cards/comment.service.js'
import type { FieldRepository } from '../cards/field.repository.js'
import type { LinkService } from '../cards/link.service.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import { GroupRepository } from '../groups/group.repository.js'
import type { MemberRepository } from '../members/member.repository.js'
import { SpaceRepository } from '../spaces/space.repository.js'
import type { SpaceGate } from '../spaces/space-gate.js'
import { ProposalRepository } from './proposal.repository.js'
import { ProposalService } from './proposal.service.js'
import { ProposalApplier } from './proposal-applier.js'
import { ProposalViews } from './proposal-views.js'

type ProposalDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  gate: SpaceGate
  cardGate: CardGate
  cards: CardRepository
  fields: FieldRepository
  workflows: WorkflowRepository
  members: MemberRepository
  services: { cards: CardService; comments: CommentService; links: LinkService }
}

/** Proposals (Etapa 6a, ADR-0019): the service, the applier that runs approved items, and their views. */
export const buildProposals = (deps: ProposalDeps) => {
  const { db, clock, cards, workflows, members } = deps
  const views = new ProposalViews({
    clock,
    access: deps.access,
    spaces: new SpaceRepository(db),
    cards,
    fields: deps.fields,
    workflows,
    groups: new GroupRepository(db),
    members
  })
  const applier = new ProposalApplier({ ...deps.services, cardRows: cards, workflows })
  return new ProposalService({
    ...deps,
    proposals: new ProposalRepository(db),
    applier,
    views,
    logger: createLogger('work', 'proposals')
  })
}
