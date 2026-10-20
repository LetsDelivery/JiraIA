import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { DependencyUnavailableException, ValidationException } from '@jiraia/core'

import { type DraftRequest, type DraftWriter, type ModelDraft, modelDraftSchema } from './draft.js'

/**
 * Drafts by Claude (ADR-0011). The system prompt is fixed — so it caches — and the kind asked for, when
 * the person chose one, goes in a system message after their last message.
 */
const SYSTEM = `Você é o assistente de criação do LET’S Draw AI, onde as equipes da LET’S (empresa de logística e delivery) guardam processos, especificações, atas e decisões.

A pessoa descreve o que quer criar e você devolve um rascunho completo, pronto para editar:
- "kind": "page" para um documento; "whiteboard" para um quadro branco de ideias, mapas, fluxos ou brainstorms.
- "title": um título curto, sem pontuação final.
- "reply": 1 a 3 frases em português dizendo o que você montou, ou o que mudou desde a versão anterior.
- Para uma página, "markdown" traz o documento inteiro: títulos (#, ##, ###), parágrafos, listas, listas de tarefas ("- [ ]"), citações (">") e blocos de código quando fizer sentido. Sem tabelas e sem HTML. "sections" fica vazio.
- Para um quadro, "sections" traz de 2 a 6 seções, cada uma com de 2 a 8 notas curtas (até 12 palavras). "markdown" fica vazio.

Escreva em português do Brasil, com o vocabulário de quem trabalha com operação, produto e tecnologia. Não invente números, nomes de clientes nem dados que a pessoa não deu: use marcadores como "[definir]". Quando a pessoa pedir mudanças, devolva o rascunho inteiro já com elas.`

const KIND_HINT = { page: 'Crie uma página.', whiteboard: 'Crie um quadro branco.' } as const

export class AnthropicDraftWriter implements DraftWriter {
  readonly byModel = true

  constructor(private readonly client: Anthropic) {}

  async write(request: DraftRequest): Promise<ModelDraft> {
    const messages: Anthropic.Beta.BetaMessageParam[] = request.messages.map((message) => ({
      role: message.role,
      content: message.text
    }))
    const hint = request.kind === 'auto' ? [] : [{ role: 'system' as const, content: KIND_HINT[request.kind] }]
    const response = await this.client.beta.messages
      .parse({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Low effort: the HTTP API cuts a request at 30 seconds, and a first draft needs speed more than depth.
        output_config: { effort: 'low', format: betaZodOutputFormat(modelDraftSchema) },
        system: SYSTEM,
        messages: [...messages, ...hint] as Anthropic.Beta.BetaMessageParam[]
      })
      .catch((error: unknown) => {
        throw error instanceof Anthropic.APIError
          ? new DependencyUnavailableException('Anthropic', error.message)
          : error
      })
    if (response.stop_reason === 'refusal') {
      throw new ValidationException('The model declined to draft this request', {
        category: response.stop_details?.category ?? null
      })
    }
    if (!response.parsed_output) {
      throw new DependencyUnavailableException('Anthropic', `answered no draft (stop reason ${response.stop_reason})`)
    }
    return response.parsed_output
  }
}
