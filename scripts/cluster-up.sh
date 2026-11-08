#!/usr/bin/env bash
# Create the kind cluster (idempotent).
source "$(dirname "$0")/lib.sh"

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  log "cluster '$CLUSTER_NAME' already exists"
else
  log "creating kind cluster '$CLUSTER_NAME'"
  kind create cluster --config "$ROOT/kind/cluster.yaml" --wait 120s
fi
k get nodes -o wide
