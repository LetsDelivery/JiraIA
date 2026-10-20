/**
 * The one database the test suite may touch: the `postgres-test` container in docker-compose.yml.
 *
 * Its port is not Postgres's default, so nothing else running on this machine can be mistaken for
 * it, and the guard asserts these exact values.
 */
export const TEST_DATABASE = { host: '127.0.0.1', port: 8210, name: 'jiraia_test' } as const

export const TEST_DATABASE_URL = `postgres://jiraia:jiraia@${TEST_DATABASE.host}:${TEST_DATABASE.port}/${TEST_DATABASE.name}`

/** Hosts under this suffix are mocks (MSW). `.test` is reserved by RFC 6761 and resolves nowhere. */
export const COUNTERPARTY_SUFFIX = '.counterparty.test'
