// Idempotent schema migration. Runs as a Kubernetes Job (ArgoCD Sync hook,
// wave 0, before the Deployment in wave 1) and in CI integration tests.
//
//  - MySQL: applies migrations/NNN_*.sql in order, tracked in schema_migrations
//  - Elasticsearch: creates the items index with an explicit mapping if absent
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createMysql, createEs } from './clients.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function retry(label, fn, { attempts = 30, delayMs = 2000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`[migrate] ${label} not ready (${err.message}); retry ${i}/${attempts}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function migrateMysql(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`);
  const [rows] = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    // MySQL DDL auto-commits, so each file must be idempotent on its own.
    for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
    await pool.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    console.log(`[migrate] mysql applied ${file}`);
  }
}

export async function migrateEs(es, index) {
  if (await es.indices.exists({ index })) {
    console.log(`[migrate] es index "${index}" exists`);
    return;
  }
  await es.indices.create({
    index,
    settings: { number_of_shards: 1, number_of_replicas: 0 },
    mappings: {
      properties: {
        id: { type: 'long' },
        name: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
        description: { type: 'text' },
      },
    },
  });
  console.log(`[migrate] es index "${index}" created`);
}

async function main() {
  const cfg = loadConfig();
  const pool = createMysql(cfg.mysql);
  const es = createEs(cfg.es);
  try {
    await retry('mysql', () => pool.query('SELECT 1'));
    await migrateMysql(pool);
    await retry('elasticsearch', () => es.cluster.health({ wait_for_status: 'yellow', timeout: '5s' }));
    await migrateEs(es, cfg.es.index);
    console.log('[migrate] done');
  } finally {
    await Promise.allSettled([pool.end(), es.close()]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
}
