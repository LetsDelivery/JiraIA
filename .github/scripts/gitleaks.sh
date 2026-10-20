#!/usr/bin/env bash
#
# Scans git history for committed secrets with a pinned gitleaks binary.
#
#   .github/scripts/gitleaks.sh origin/master..HEAD   # the commits a pull request adds
#   .github/scripts/gitleaks.sh                       # every commit, for the monthly sweep
#
# The binary is downloaded and its checksum compared against the one written below, rather than
# run through `gitleaks/gitleaks-action`: that action wants a licence key for an organisation, and
# a pinned release plus a checksum is the same guarantee the SHA pins give the actions themselves.
# Bumping it is editing the version and both checksums from the release's `checksums.txt`.
#
# There is no push protection on this plan, so this runs after the push: a finding here means the
# value is already on the remote and in every clone. Rotate it — the history is not rewritten, see
# "The security baseline" in AGENTS.md. `.gitleaks.toml` and `.gitleaksignore` hold the exceptions.
set -euo pipefail

VERSION=8.30.1

# One checksum per architecture: CI runs on ARM (ADR-0107) and a laptop or a GitHub runner may not.
case "$(uname -m)" in
  aarch64 | arm64) ARCH=arm64 SHA256=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  x86_64) ARCH=x64 SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  *) echo "gitleaks: no pinned checksum for $(uname -m); expected aarch64 or x86_64" >&2; exit 1 ;;
esac

workdir=$(mktemp -d)
archive="$workdir/gitleaks.tar.gz"
curl -fsSL -o "$archive" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_${ARCH}.tar.gz"
echo "${SHA256}  ${archive}" | sha256sum --check --strict
tar -xzf "$archive" -C "$workdir" gitleaks

args=(git --redact --no-banner --exit-code 1)
if [[ $# -gt 0 ]]; then args+=(--log-opts "$1"); fi
"$workdir/gitleaks" "${args[@]}" .
