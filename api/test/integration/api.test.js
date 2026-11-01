// Integration tests: real Redis, MySQL and Elasticsearch.
// Run with INTEGRATION=1 (CI service containers or `docker compose`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/app.js';
import { createRedis, createMysql, createEs, closeAll } from '../../src/clients.js';
import { migrateMysql, migrateEs } from '../../src/migrate.js';

const enabled = process.env.INTEGRATION === '1';
let app;
let deps;

before(async () => {
  if (!enabled) return;
  const cfg = loadConfig();
  deps = { redis: createRedis(cfg.redis), mysql: createMysql(cfg.mysql), es: createEs(cfg.es) };
  await migrateMysql(deps.mysql);
  await migrateEs(deps.es, cfg.es.index);
  app = buildApp({ ...deps, esIndex: cfg.es.index, depTimeoutMs: 3000 });
});

after(async () => {
  if (app) await app.close();
  if (deps) await closeAll(deps);
});

test('readyz is green against real deps', { skip: !enabled }, async () => {
  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 200, res.body);
});

test('create -> read (MISS, HIT) -> search', { skip: !enabled }, async () => {
  const name = `integration-${Date.now()}`;
  const created = await app.inject({
    method: 'POST',
    url: '/items',
    payload: { name, description: 'searchable elasticsearch document' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const { id } = created.json();

  const miss = await app.inject({ method: 'GET', url: `/items/${id}` });
  assert.equal(miss.headers['x-cache'], 'MISS');
  const hit = await app.inject({ method: 'GET', url: `/items/${id}` });
  assert.equal(hit.headers['x-cache'], 'HIT');

  const search = await app.inject({ method: 'GET', url: `/search?q=${name}` });
  assert.equal(search.statusCode, 200);
  assert.ok(search.json().items.some((i) => i.id === id), 'created item should be searchable');
});
