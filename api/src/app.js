// Fastify app factory. Dependencies are injected so unit tests can pass stubs
// and integration tests can pass real clients.
import Fastify from 'fastify';
import client from 'prom-client';

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const itemSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 10000 },
    },
  },
};

export function buildApp({
  redis,
  mysql,
  es,
  esIndex = 'items',
  cacheTtlSeconds = 60,
  depTimeoutMs = 1000,
  logger = false,
  state = { shuttingDown: false },
}) {
  const app = Fastify({ logger, disableRequestLogging: false });

  // ---- metrics -------------------------------------------------------------
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });
  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const cacheResults = new client.Counter({
    name: 'item_cache_results_total',
    help: 'Item cache lookups by result',
    labelNames: ['result'],
    registers: [registry],
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? 'unmatched';
    if (route === '/metrics') return;
    httpDuration
      .labels(request.method, route, String(reply.statusCode))
      .observe(reply.elapsedTime / 1000);
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  // ---- health --------------------------------------------------------------
  // Liveness: process is up and the event loop answers. No dependency calls,
  // otherwise a Redis blip would restart every API pod.
  app.get('/healthz', async () => ({ status: 'ok' }));

  // Readiness: can this pod serve real traffic right now?
  // Only MySQL (system of record) gates readiness. Redis and ES degrade
  // gracefully (cache bypass / search 5xx), so failing readiness on them
  // would turn a partial outage into a full one across every replica.
  const criticalDeps = new Set(['mysql']);
  app.get('/readyz', async (_request, reply) => {
    if (state.shuttingDown) {
      return reply.code(503).send({ status: 'shutting_down' });
    }
    const checks = {
      redis: () => redis.ping(),
      mysql: () => mysql.query('SELECT 1'),
      es: () => es.ping(),
    };
    const results = {};
    await Promise.all(
      Object.entries(checks).map(async ([name, fn]) => {
        try {
          await withTimeout(fn(), depTimeoutMs, name);
          results[name] = 'ok';
        } catch (err) {
          results[name] = 'fail';
          app.log.warn({ dep: name, err: err.message }, 'readiness check failed');
        }
      }),
    );
    const ok = [...criticalDeps].every((d) => results[d] === 'ok');
    const degraded = Object.values(results).some((r) => r !== 'ok');
    return reply
      .code(ok ? 200 : 503)
      .send({ status: ok ? (degraded ? 'degraded' : 'ok') : 'unavailable', ...results });
  });

  // ---- items ---------------------------------------------------------------
  const cacheKey = (id) => `item:${id}`;

  // Write path: MySQL is the system of record. ES indexing and cache
  // invalidation are best-effort dual writes (see ADR-0005: outbox/CDC is a
  // research track).
  app.post('/items', { schema: itemSchema }, async (request, reply) => {
    const { name, description = null } = request.body;
    const [result] = await mysql.query(
      'INSERT INTO items (name, description) VALUES (?, ?)',
      [name, description],
    );
    const item = { id: result.insertId, name, description };

    try {
      await es.index({ index: esIndex, id: String(item.id), document: item, refresh: 'wait_for' });
    } catch (err) {
      request.log.error({ err: err.message, id: item.id }, 'es index failed (item persisted in mysql)');
    }
    try {
      await redis.del(cacheKey(item.id));
    } catch (err) {
      request.log.warn({ err: err.message }, 'cache invalidation failed');
    }
    return reply.code(201).send(item);
  });

  // Read path: cache-aside. Redis failures degrade to MySQL, never to a 5xx.
  app.get('/items/:id', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'id must be a positive integer' });
    }

    try {
      const cached = await redis.get(cacheKey(id));
      if (cached) {
        cacheResults.labels('hit').inc();
        reply.header('x-cache', 'HIT');
        return JSON.parse(cached);
      }
      cacheResults.labels('miss').inc();
    } catch (err) {
      cacheResults.labels('error').inc();
      request.log.warn({ err: err.message }, 'cache read failed, falling back to mysql');
    }

    const [rows] = await mysql.query(
      'SELECT id, name, description FROM items WHERE id = ?',
      [id],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }
    const item = rows[0];
    try {
      await redis.set(cacheKey(id), JSON.stringify(item), 'EX', cacheTtlSeconds);
    } catch (err) {
      request.log.warn({ err: err.message }, 'cache fill failed');
    }
    reply.header('x-cache', 'MISS');
    return item;
  });

  app.get('/search', async (request, reply) => {
    const q = String(request.query.q ?? '').trim();
    if (!q) return reply.code(400).send({ error: 'q is required' });
    const res = await es.search({
      index: esIndex,
      size: 20,
      query: { multi_match: { query: q, fields: ['name^2', 'description'] } },
    });
    return {
      total: res.hits.total?.value ?? res.hits.hits.length,
      items: res.hits.hits.map((h) => ({ score: h._score, ...h._source })),
    };
  });

  return app;
}
