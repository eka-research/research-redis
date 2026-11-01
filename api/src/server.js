// Process entrypoint: wiring + graceful shutdown.
//
// Shutdown sequence on SIGTERM (kubelet):
//   1. flip readiness to 503 so the endpoint is removed from the Service
//   2. keep serving in-flight/new requests for SHUTDOWN_DELAY_MS while
//      kube-proxy / Envoy converge
//   3. close the server (drains keep-alive) and dependency clients
// terminationGracePeriodSeconds in the Deployment must exceed step 2 + 3.
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createRedis, createMysql, createEs, closeAll } from './clients.js';

const cfg = loadConfig();
const deps = {
  redis: createRedis(cfg.redis),
  mysql: createMysql(cfg.mysql),
  es: createEs(cfg.es),
};
const state = { shuttingDown: false };

const app = buildApp({
  ...deps,
  esIndex: cfg.es.index,
  cacheTtlSeconds: cfg.cacheTtlSeconds,
  depTimeoutMs: cfg.depTimeoutMs,
  logger: { level: cfg.logLevel },
  state,
});

app.addHook('onClose', async () => closeAll(deps));

deps.redis.on('error', (err) => app.log.warn({ err: err.message }, 'redis client error'));

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  state.shuttingDown = true;
  app.log.info({ signal, delayMs: cfg.shutdownDelayMs }, 'shutdown: readiness off, draining');
  await new Promise((r) => setTimeout(r, cfg.shutdownDelayMs));
  try {
    await app.close();
    app.log.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'shutdown failed');
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await app.listen({ host: '0.0.0.0', port: cfg.port });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
