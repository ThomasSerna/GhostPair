import { describe, expect, it } from 'vitest';
import { configFromEnv } from './config.js';
import { RateLimit } from './rate-limit.js';

describe('production configuration', () => {
  it('starts without an origin allowlist and ignores legacy values', () => {
    const config = configFromEnv({});
    expect(config).not.toHaveProperty('allowedOrigins');
    for (const legacy of ['', '*', 'https://example.com', 'chrome-extension://replace_with_your_extension_id', `chrome-extension://${'a'.repeat(32)}`]) {
      expect(configFromEnv({ ALLOWED_ORIGINS: legacy })).toEqual(config);
    }
  });

  it('permits localhost origins only with an explicit development opt-in', () => {
    expect(configFromEnv({}).allowLocalhostOrigins).toBe(false);
    expect(configFromEnv({ DEV_ALLOW_LOCALHOST_ORIGINS: 'true' }).allowLocalhostOrigins).toBe(true);
    for (const value of ['1', 'false', 'TRUE', '']) {
      expect(configFromEnv({ DEV_ALLOW_LOCALHOST_ORIGINS: value }).allowLocalhostOrigins).toBe(false);
    }
  });

  it('rejects invalid ports and requires explicit proxy trust', () => {
    for (const PORT of ['-1', '0', 'abc', '65536', '1.5']) {
      expect(() => configFromEnv({ PORT })).toThrow();
    }
    expect(configFromEnv({}).trustProxy).toBe(false);
    expect(configFromEnv({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
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
  for (const parameter of ['sslnegotiation=direct', 'ssl=no-verify', 'uselibpqcompat=true']) expect(() => configFromEnv({ ...base, DATABASE_URL: base.DATABASE_URL + '?' + parameter })).toThrow('Configure TLS');
  for (const parameter of ['query_timeout=0', 'statement_timeout=0', 'connectionTimeoutMillis=0', 'options=-c%20statement_timeout%3D0']) expect(() => configFromEnv({ ...base, DATABASE_URL: base.DATABASE_URL + '?' + parameter })).toThrow('timeouts');
  expect(configFromEnv({ ...base, DATABASE_URL: base.DATABASE_URL + '?application_name=GhostPair' }).databaseSslMode).toBe('verify-full');
  expect(() => configFromEnv({ ...base, DATABASE_SSL_MODE: 'require' })).toThrow('DATABASE_SSL_MODE');
  expect(() => configFromEnv({ ...base, DATABASE_SSL_MODE: 'disable', DATABASE_SSL_CA_FILE: 'ca.pem' })).toThrow();
});
