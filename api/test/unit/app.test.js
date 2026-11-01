// Unit tests: no network. Dependencies are in-memory stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';

function stubs({ redisDown = false, esDown = false, mysqlDown = false } = {}) {
  const cache = new Map();
  const rows = new Map();
  let nextId = 1;
  const calls = { mysqlSelect: 0, esIndex: 0 };

  const fail = () => Promise.reject(new Error('down'));
  const redis = {
    ping: () => (redisDown ? fail() : Promise.resolve('PONG')),
    get: (k) => (redisDown ? fail() : Promise.resolve(cache.get(k) ?? null)),
    set: (k, v) => (redisDown ? fail() : (cache.set(k, v), Promise.resolve('OK'))),
    del: (k) => (redisDown ? fail() : Promise.resolve(cache.delete(k) ? 1 : 0)),
  };
  const mysql = {
    async query(sql, params = []) {
      if (sql === 'SELECT 1') {
        if (mysqlDown) throw new Error('down');
        return [[{ 1: 1 }]];
      }
      if (sql.startsWith('INSERT INTO items')) {
        const id = nextId++;
        rows.set(id, { id, name: params[0], description: params[1] });
        return [{ insertId: id }];
      }
      if (sql.startsWith('SELECT id, name, description FROM items')) {
        calls.mysqlSelect++;
        const r = rows.get(params[0]);
        return [r ? [r] : []];
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  const es = {
    ping: () => (esDown ? fail() : Promise.resolve(true)),
    index: () => (calls.esIndex++, esDown ? fail() : Promise.resolve({})),
    search: async () => ({ hits: { total: { value: 0 }, hits: [] } }),
  };
  return { redis, mysql, es, calls, cache };
}

test('GET /healthz is dependency-free', async () => {
  const app = buildApp(stubs({ redisDown: true, esDown: true }));
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
});

test('GET /readyz returns 200 when all deps are up', async () => {
  const app = buildApp(stubs());
  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', redis: 'ok', mysql: 'ok', es: 'ok' });
});

test('GET /readyz stays 200 (degraded) when a non-critical dep is down', async () => {
  const app = buildApp(stubs({ esDown: true, redisDown: true }));
  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'degraded');
  assert.equal(res.json().es, 'fail');
});

test('GET /readyz returns 503 when MySQL is down', async () => {
  const app = buildApp(stubs({ mysqlDown: true }));
  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().mysql, 'fail');
});

test('GET /readyz returns 503 while shutting down', async () => {
  const app = buildApp({ ...stubs(), state: { shuttingDown: true } });
  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 503);
});

test('POST /items validates the body', async () => {
  const app = buildApp(stubs());
  const res = await app.inject({ method: 'POST', url: '/items', payload: { nope: 1 } });
  assert.equal(res.statusCode, 400);
});

test('cache-aside: MISS then HIT, MySQL read once', async () => {
  const s = stubs();
  const app = buildApp(s);
  const created = await app.inject({ method: 'POST', url: '/items', payload: { name: 'redis' } });
  assert.equal(created.statusCode, 201);
  const { id } = created.json();

  const first = await app.inject({ method: 'GET', url: `/items/${id}` });
  assert.equal(first.headers['x-cache'], 'MISS');
  const second = await app.inject({ method: 'GET', url: `/items/${id}` });
  assert.equal(second.headers['x-cache'], 'HIT');
  assert.equal(s.calls.mysqlSelect, 1);
  assert.deepEqual(second.json(), first.json());
});

test('Redis outage degrades to MySQL, not 5xx', async () => {
  const s = stubs({ redisDown: true });
  const app = buildApp(s);
  const created = await app.inject({ method: 'POST', url: '/items', payload: { name: 'x' } });
  assert.equal(created.statusCode, 201);
  const res = await app.inject({ method: 'GET', url: `/items/${created.json().id}` });
  assert.equal(res.statusCode, 200);
});

test('ES outage on write still persists the item', async () => {
  const s = stubs({ esDown: true });
  const app = buildApp(s);
  const res = await app.inject({ method: 'POST', url: '/items', payload: { name: 'x' } });
  assert.equal(res.statusCode, 201);
  assert.equal(s.calls.esIndex, 1);
});

test('GET /items/:id rejects non-numeric ids', async () => {
  const app = buildApp(stubs());
  const res = await app.inject({ method: 'GET', url: '/items/abc' });
  assert.equal(res.statusCode, 400);
});

test('GET /search requires q', async () => {
  const app = buildApp(stubs());
  const res = await app.inject({ method: 'GET', url: '/search' });
  assert.equal(res.statusCode, 400);
});

test('GET /metrics exposes the HTTP histogram', async () => {
  const app = buildApp(stubs());
  await app.inject({ method: 'GET', url: '/healthz' });
  // onResponse fires after inject() resolves; let it run before scraping.
  await new Promise((r) => setImmediate(r));
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /http_request_duration_seconds_bucket/);
});
