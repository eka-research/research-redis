#!/usr/bin/env bash
# Build the API image and load it directly into kind nodes.
source "$(dirname "$0")/lib.sh"

log "building $IMAGE"
docker build -t "$IMAGE" "$ROOT/api"
log "loading $IMAGE into kind/$CLUSTER_NAME"
kind load docker-image "$IMAGE" --name "$CLUSTER_NAME"
