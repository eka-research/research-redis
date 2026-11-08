#!/usr/bin/env bash
# Apply the gitops manifests straight to kind, without ArgoCD. CI e2e uses this,
# and so can the local inner loop. Don't mix it with argocd-bootstrap.sh on the
# same cluster: ArgoCD would fight these changes (selfHeal).
#   GITOPS_DIR=../gitops bash scripts/deploy-direct.sh
source "$(dirname "$0")/lib.sh"

[ -d "$GITOPS_DIR" ] || die "GITOPS_DIR not found: $GITOPS_DIR"
apply() { log "apply $1"; kbuild "$GITOPS_DIR/$1" | k apply --server-side --force-conflicts -f - >/dev/null; }

apply platform/gateway/controller
k -n envoy-gateway-system rollout status deploy/envoy-gateway --timeout=180s
k wait --for=condition=Established crd/envoyproxies.gateway.envoyproxy.io crd/gateways.gateway.networking.k8s.io --timeout=60s

apply platform/gateway/config
apply platform/data-namespace
apply platform/redis/overlays/kind
apply platform/mysql/overlays/kind
apply platform/elasticsearch/overlays/kind

log "waiting for data stores"
for s in redis mysql elasticsearch; do
  k -n eka-data rollout status "statefulset/$s" --timeout=300s
done

# Jobs are immutable: delete the previous run so the new image migrates.
k -n eka-api delete job api-migrate --ignore-not-found >/dev/null 2>&1 || true
apply apps/api/overlays/kind
log "waiting for migration + api"
k -n eka-api wait --for=condition=complete job/api-migrate --timeout=300s \
  || { k -n eka-api logs job/api-migrate --tail=50 || true; die "migration failed"; }
k -n eka-api rollout status deploy/api --timeout=180s
k wait -n eka-gateway --for=condition=Programmed gateway/eka --timeout=120s
log "deployed. try: bash scripts/smoke.sh"
