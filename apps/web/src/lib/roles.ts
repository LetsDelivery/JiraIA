export const ROLES = ['admin', 'member', 'reader'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  member: 'Membro',
  reader: 'Leitor'
}

export const ROLE_HINT: Record<Role, string> = {
  admin: 'Edita, gerencia o espaço e dá papéis',
  member: 'Lê e edita tudo no espaço',
  reader: 'Lê tudo, sem editar — o que toda a LET’S já tem'
}

/** The roles a person or a group is given on a space (ADR-0012). */
export const ROLE_OPTIONS = ROLES.map((role) => ({
  value: role,
  label: ROLE_LABEL[role],
  hint: ROLE_HINT[role]
}))

/** Whether a role writes in the space — cards and pages alike (ADR-0004). */
export const canWriteIn = (isOrgAdmin: boolean, role: Role | undefined): boolean =>
  isOrgAdmin || role === 'admin' || role === 'member'
