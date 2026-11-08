# research-redis

Node.js 24 LTS + Fastify API service backed by **Redis 8**, **MySQL 8.4 LTS**, and **Elasticsearch 9.5**, running on a local **kind** cluster with **Envoy Gateway** (Gateway API), **GitHub Actions** CI/e2e, and **ArgoCD** GitOps.

- Desired-state repository: [`eka-research/research-redis-gitops`](https://github.com/eka-research/research-redis-gitops)

## Quickstart (local kind)

```bash
# 1. Verify toolchain & host kernel settings (vm.max_map_count, disk, ports)
bash scripts/doctor.sh

# 2. Create kind cluster (1 control-plane + 1 worker, Envoy NodePort 80->30080)
bash scripts/cluster-up.sh

# 3. Build API image and load into kind (no local registry required)
bash scripts/image-load.sh

# 4a. Fast inner loop: apply manifests directly via Kustomize
GITOPS_DIR=../gitops bash scripts/deploy-direct.sh

# 4b. OR full GitOps loop: install ArgoCD + root app-of-apps
GITOPS_DIR=../gitops bash scripts/argocd-bootstrap.sh

# 5. Run end-to-end smoke test through Envoy Gateway (Host: api.localtest.me)
bash scripts/smoke.sh
```

## Containerized Node.js dev loop (no host npm required)

```bash
docker compose run --rm api npm run lint
docker compose run --rm api npm test
docker compose --profile integration run --rm api npm run test:integration
```
