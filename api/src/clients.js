// Client factories. Each client is configured to fail fast (short timeouts, no
// unbounded offline queues) so /readyz reflects real dependency state.
import Redis from 'ioredis';
import mysql from 'mysql2/promise';
import { Client as ElasticClient } from '@elastic/elasticsearch';

export function createRedis(cfg) {
  return new Redis({
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    // Reject commands while disconnected instead of queueing them forever.
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
}

export function createMysql(cfg) {
  return mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: 10,
    connectTimeout: 3000,
    waitForConnections: true,
    queueLimit: 100,
  });
}

export function createEs(cfg) {
  return new ElasticClient({
    node: cfg.node,
    auth: cfg.username ? { username: cfg.username, password: cfg.password } : undefined,
    requestTimeout: 3000,
    maxRetries: 1,
  });
}

export async function closeAll({ redis, mysql: pool, es }) {
  await Promise.allSettled([redis?.quit(), pool?.end(), es?.close()]);
}
