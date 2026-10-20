import type { Caller } from '@jiraia/http'

import { boardFromSections } from './board-draft.js'
import { type DraftRequest, type DraftView, type DraftWriter, draftText, markdownToDoc } from './draft.js'
import type { DrawGate } from './draw-gate.js'

/**
 * "Criar com IA" (ADR-0011): the conversation so far becomes a draft the person reads in the chat.
 * Nothing is written: the draft becomes content only when they create it, through the content tree.
 */
export class DraftService {
  constructor(private readonly deps: { drawGate: DrawGate; writer: DraftWriter }) {}

  async draft(caller: Caller, spaceId: string, request: DraftRequest): Promise<DraftView> {
    await this.deps.drawGate.space(caller, spaceId, 'write')
    const draft = await this.deps.writer.write(request)
    const json = draft.kind === 'page' ? markdownToDoc(draft.markdown) : boardFromSections(draft.sections)
    return { ...draft, json, text: draftText(draft), byModel: this.deps.writer.byModel }
  }
}
