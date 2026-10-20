/**
 * Conventional commits, with the scope restricted to modules that exist in this monorepo.
 *
 * Same rule as LetsDelivery/uselets: the scope is a module, not a feature. Which part of a module a
 * change touched is what the subject line is for.
 */
const SERVICES = ['work']
const PACKAGES = ['core', 'logger', 'http', 'authorization', 'db', 'testing']
const APPS = ['web']
// Every directory under `infra/` that a commit can be about, plus the repository itself.
const INFRA = ['platform', 'layer', 'deploy', 'local', 'contracts', 'ci', 'docs', 'repo']
const CHORE = ['deps']

const DEPENDABOT = /^Signed-off-by: dependabot\[bot\]/m

module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => DEPENDABOT.test(message)],
  rules: {
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', [...SERVICES, ...PACKAGES, ...APPS, ...INFRA, ...CHORE]],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100]
  }
}
