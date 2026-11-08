#!/usr/bin/env bash
# Install ArgoCD and hand the cluster over to GitOps (app-of-apps).
# The gitops repo must be pushed: ArgoCD pulls from GitHub, not your disk.
source "$(dirname "$0")/lib.sh"

log "installing ArgoCD"
kbuild "$GITOPS_DIR/bootstrap/argocd" | k apply --server-side --force-conflicts -f - >/dev/null
k -n argocd rollout status deploy/argocd-server --timeout=300s
k -n argocd rollout status deploy/argocd-repo-server --timeout=300s
k -n argocd rollout status statefulset/argocd-application-controller --timeout=300s
# argocd-cm changes are read at startup.
k -n argocd rollout restart deploy/argocd-server deploy/argocd-repo-server statefulset/argocd-application-controller >/dev/null

log "applying root app-of-apps"
k apply -f "$GITOPS_DIR/clusters/kind/root-app.yaml"

pw="$(k -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d)"
cat <<EOF

ArgoCD UI:  kubectl --context $KCTX -n argocd port-forward svc/argocd-server 8443:80
            http://localhost:8443   user: admin   password: $pw
            (rotate it and delete argocd-initial-admin-secret when you're done)
Watch:      kubectl --context $KCTX -n argocd get applications -w
EOF
