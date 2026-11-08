#!/usr/bin/env bash
# Tear down the kind cluster. Images and PV data go with it.
source "$(dirname "$0")/lib.sh"
kind delete cluster --name "$CLUSTER_NAME"
