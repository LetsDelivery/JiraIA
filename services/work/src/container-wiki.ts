import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import type { AuditTrail } from './audit/audit.js'
import type { ContentRepository } from './draw/content.repository.js'
import type { ContentService } from './draw/content.service.js'
import type { DrawGate } from './draw/draw-gate.js'
import type { DrawSpaceRepository } from './draw/draw-space.repository.js'
import type { MemberRepository } from './members/member.repository.js'
import { CollectionRepository } from './wiki/collection.repository.js'
import { CollectionService } from './wiki/collection.service.js'
import { LibraryService } from './wiki/library.service.js'
import { WikiPageRepository } from './wiki/page.repository.js'
import { WikiPageService } from './wiki/page.service.js'
import { WikiContentService } from './wiki/wiki-content.service.js'

type WikiDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  members: MemberRepository
  drawGate: DrawGate
  spaces: DrawSpaceRepository
  contents: ContentRepository
  contentService: ContentService
}

/** LET’S Wiki (ADR-0033, ADR-0034): collections, pages, the lists across them, on Draw's content engine. */
export const buildWiki = ({ db, clock, ids, audit, drawGate, spaces, contents, contentService, members }: WikiDeps) => {
  const pages = new WikiPageRepository(db)
  const collections = new CollectionRepository(db)
  const wikiCollections = new CollectionService({ db, clock, ids, audit, drawGate, spaces, collections })
  const onPages = { db, clock, audit, collections: wikiCollections, pages }
  return {
    pages,
    services: {
      wikiCollections,
      wikiPages: new WikiPageService({ ...onPages, drawGate, contents, members }),
      wikiContent: new WikiContentService({ ...onPages, drawGate, contents: contentService }),
      wikiLibrary: new LibraryService({ clock, drawGate, collections: wikiCollections, pages })
    }
  }
}
