import type { ApiError } from '@/api/client'

/**
 * What a refusal means, in the language of the screen.
 *
 * The API explains itself in English for whoever reads the logs; the person reading the screen gets
 * a sentence chosen by the code, never the API's message (same rule as uselets ADR-0105).
 */
const BY_CODE: Record<string, string> = {
  FORBIDDEN: 'Você não tem permissão para fazer isso.',
  NOT_FOUND: 'Não encontrado, ou você não tem acesso.',
  UNAUTHENTICATED: 'Sua sessão terminou. Entre de novo.',
  VALIDATION_FAILED: 'Confira os campos e tente de novo.',
  CONFLICT: 'Isso entra em conflito com o que já existe.'
}

const CONFLICTS: { field: string; sentence: (value: string) => string }[] = [
  {
    field: 'missing',
    sentence: () => 'O card criado não tem um estado cancelado para onde voltar. Adicione um ao fluxo.'
  },
  { field: 'stale', sentence: () => 'O card mudou desde a proposta. Confira e confirme o conflito para aprovar.' },
  { field: 'fields', sentence: () => 'O card mudou depois da proposta. Reverta essa mudança à mão.' },
  { field: 'proposalId', sentence: () => 'A proposta já foi decidida, venceu ou não pôde ser aplicada.' },
  { field: 'key', sentence: (key) => `Já existe um espaço com a chave ${key}.` },
  { field: 'email', sentence: (email) => `${email} já é membro.` },
  { field: 'name', sentence: (name) => `Já existe um grupo chamado ${name}.` },
  { field: 'systemName', sentence: (name) => `Já existe um sistema chamado ${name}.` },
  { field: 'heldProfile', sentence: (name) => `A pessoa já tem o perfil ${name}.` },
  { field: 'openProfile', sentence: (name) => `Já existe um pedido em aberto do perfil ${name} para essa pessoa.` },
  { field: 'archivedProfile', sentence: (name) => `O perfil ${name} está arquivado e não pode ser pedido.` },
  { field: 'requestStatus', sentence: () => 'O pedido já mudou de situação. Atualize a página.' }
]

/** Refusals of a field whose value the server names: what to change, in the words of the screen. */
const VALIDATIONS: { field: string; sentence: string }[] = [
  { field: 'privilege', sentence: 'Perfil privilegiado precisa de data de validade.' },
  { field: 'expiresAt', sentence: 'A validade precisa ser uma data futura, até 90 dias para perfil privilegiado.' },
  { field: 'photo', sentence: 'Não foi possível ler essa imagem. Escolha um JPG, PNG ou WebP.' }
]

export const refusalSentence = (refusal: unknown): string => {
  const error = (refusal as ApiError | undefined)?.error
  if (!error) {
    return 'Não foi possível concluir. Tente de novo.'
  }
  if (error.code === 'CONFLICT') {
    const known = CONFLICTS.find((conflict) => typeof error.details?.[conflict.field] === 'string')
    if (known) {
      return known.sentence(String(error.details?.[known.field]))
    }
  }
  if (error.code === 'VALIDATION_FAILED') {
    const known = VALIDATIONS.find((validation) => error.details?.[validation.field] !== undefined)
    if (known) {
      return known.sentence
    }
  }
  return BY_CODE[error.code] ?? 'Não foi possível concluir. Tente de novo.'
}
