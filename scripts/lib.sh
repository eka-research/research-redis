#!/usr/bin/env bash
# Shared helpers. Source this file; don't execute it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-eka}"
GITOPS_DIR="${GITOPS_DIR:-$ROOT/../gitops}"
IMAGE="${IMAGE:-ghcr.io/eka-research/research-redis:dev}"
KCTX="kind-${CLUSTER_NAME}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

k() { kubectl --context "$KCTX" "$@"; }

# Prefer standalone kustomize (has `edit`); fall back to kubectl's embedded one.
kbuild() {
  if command -v kustomize >/dev/null 2>&1; then kustomize build "$1"; else kubectl kustomize "$1"; fi
}
