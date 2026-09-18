import { describe, expect, it } from 'vitest';
import { configFromEnv } from './config.js';
import { RateLimit } from './rate-limit.js';

describe('production configuration', () => {
  it('fails closed without an origin allowlist and rejects wildcard or web origins', () => {
    expect(() => configFromEnv({})).toThrow('ALLOWED_ORIGINS');
    for (const invalid of ['*', 'https://example.com', 'chrome-extension://*', `chrome-extension://${'q'.repeat(32)}`]) {
      expect(() => configFromEnv({ ALLOWED_ORIGINS: invalid })).toThrow('exact');
    }
    const origin = `chrome-extension://${'a'.repeat(32)}`;
    expect(configFromEnv({ ALLOWED_ORIGINS: origin }).allowedOrigins).toEqual([origin]);
    expect(configFromEnv({ DEV_ALLOW_LOCALHOST_ORIGINS: 'true' }).allowLocalhostOrigins).toBe(true);
    expect(() => configFromEnv({ DEV_ALLOW_LOCALHOST_ORIGINS: '1' })).toThrow('ALLOWED_ORIGINS');
  });

  it('rejects invalid ports and requires explicit proxy trust', () => {
    const base = { ALLOWED_ORIGINS: `chrome-extension://${'a'.repeat(32)}` };
    for (const PORT of ['-1', '0', 'abc', '65536', '1.5']) {
      expect(() => configFromEnv({ ...base, PORT })).toThrow();
    }
    expect(configFromEnv(base).trustProxy).toBe(false);
    expect(configFromEnv({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
  });
});

describe('bounded rate-limit state', () => {
  it('rejects new keys at capacity and reclaims only expired entries', () => {
    const rate = new RateLimit(2, 100, 2);
    expect(rate.allow('first', 0)).toBe(true);
    expect(rate.allow('first', 1)).toBe(true);
    expect(rate.allow('first', 2)).toBe(false);
    expect(rate.allow('second', 3)).toBe(true);
    expect(rate.allow('third', 4)).toBe(false);
    expect(rate.allow('third', 100)).toBe(true);
    expect(rate.allow('first', 101)).toBe(false);
    expect(rate.allow('first', 103)).toBe(true);
  });
});

it('selects portable PostgreSQL with explicit verified TLS and rejects conflicting URL options', () => {
  const base = { DEV_ALLOW_LOCALHOST_ORIGINS: 'true', DATABASE_URL: 'postgresql://user:password@localhost/db' };
  expect(configFromEnv(base)).toMatchObject({ databaseUrl: base.DATABASE_URL, databaseSslMode: 'verify-full' });
  expect(configFromEnv({ ...base, DATABASE_SSL_MODE: 'disable' }).databaseSslMode).toBe('disable');
  for (const DATABASE_URL of ['', 'https://localhost/db', 'postgres://localhost', base.DATABASE_URL + '?sslmode=require']) expect(() => configFromEnv({ ...base, DATABASE_URL })).toThrow();
  expect(() => configFromEnv({ ...base, DATABASE_SSL_MODE: 'require' })).toThrow('DATABASE_SSL_MODE');
  expect(() => configFromEnv({ ...base, DATABASE_SSL_MODE: 'disable', DATABASE_SSL_CA_FILE: 'ca.pem' })).toThrow();
});
