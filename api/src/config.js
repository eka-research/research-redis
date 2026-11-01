// Environment -> typed config. Fails fast on missing required values so a
// misconfigured pod crash-loops visibly instead of serving 5xx.

function required(env, name) {
  const v = env[name];
  if (v === undefined || v === '') {
    throw new Error(`missing required env var: ${name}`);
  }
  return v;
}

function int(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`env var ${name} must be an integer, got "${raw}"`);
  return n;
}

export function loadConfig(env = process.env) {
  return {
    port: int(env, 'PORT', 8080),
    logLevel: env.LOG_LEVEL ?? 'info',
    cacheTtlSeconds: int(env, 'CACHE_TTL_SECONDS', 60),
    depTimeoutMs: int(env, 'DEP_TIMEOUT_MS', 1000),
    shutdownDelayMs: int(env, 'SHUTDOWN_DELAY_MS', 5000),
    redis: {
      host: required(env, 'REDIS_HOST'),
      port: int(env, 'REDIS_PORT', 6379),
      password: env.REDIS_PASSWORD || undefined,
    },
    mysql: {
      host: required(env, 'MYSQL_HOST'),
      port: int(env, 'MYSQL_PORT', 3306),
      user: required(env, 'MYSQL_USER'),
      password: required(env, 'MYSQL_PASSWORD'),
      database: required(env, 'MYSQL_DATABASE'),
    },
    es: {
      node: required(env, 'ES_URL'),
      username: env.ES_USERNAME || undefined,
      password: env.ES_PASSWORD || undefined,
      index: env.ES_INDEX ?? 'items',
    },
  };
}
