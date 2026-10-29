import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import type { AuditTrail } from './audit/audit.js'
import { AttachmentRepository } from './cards/attachment.repository.js'
import { AttachmentService } from './cards/attachment.service.js'
import type { CardRepository } from './cards/card.repository.js'
import type { CardGate } from './cards/card-gate.js'
import type { WatcherRepository } from './cards/watcher.repository.js'
import { WatcherService } from './cards/watcher.service.js'
import { WorklogService } from './cards/worklog.js'
import type { FileStore } from './files/file-store.js'

type RecordDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  cardGate: CardGate
  cards: CardRepository
  watchers: WatcherRepository
  files: FileStore
}

/** What hangs off a card besides its fields and conversation: its files, its watchers, its logged time. */
export const buildCardRecords = ({ watchers, files, ...onCards }: RecordDeps) => ({
  attachments: new AttachmentService({ ...onCards, attachments: new AttachmentRepository(onCards.db), files }),
  watchers: new WatcherService({ db: onCards.db, clock: onCards.clock, cardGate: onCards.cardGate, watchers }),
  worklogs: new WorklogService({ db: onCards.db, cardGate: onCards.cardGate })
})
