import { validatePostgresConfig } from './postgres-devices.js';

export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  databaseUrl?: string;
  databaseSslMode: 'verify-full' | 'disable';
  databaseSslCaFile?: string;
  allowedOrigins: string[];
  allowLocalhostOrigins: boolean;
  trustProxy: boolean;
  authTimeoutMs: number;
  waitingRoomTimeoutMs: number;
  heartbeatMs: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxRooms: number;
  maxRegisteredDevices: number;
  maxPayloadBytes: number;
  maxAuthConcurrency: number;
  registrationLimit: number;
  registrationWindowMs: number;
  authIpLimit: number;
  authDeviceLimit: number;
  authWindowMs: number;
  socketMessageLimit: number;
  socketMessageWindowMs: number;
  scryptN: number;
  scryptR: number;
  scryptP: number;
}

export const defaultConfig: ServerConfig = {
  host: '127.0.0.1',
  port: 8787,
  databasePath: './data/ghostpair.sqlite',
  databaseSslMode: 'verify-full',
  allowedOrigins: [],
  allowLocalhostOrigins: false,
  trustProxy: false,
  authTimeoutMs: 10_000,
  waitingRoomTimeoutMs: 10 * 60_000,
  heartbeatMs: 30_000,
  maxConnections: 1_000,
  maxConnectionsPerIp: 10,
  maxRooms: 500,
  maxRegisteredDevices: 100_000,
  maxPayloadBytes: 64 * 1024,
  maxAuthConcurrency: 2,
  registrationLimit: 20,
  registrationWindowMs: 60 * 60_000,
  authIpLimit: 30,
  authDeviceLimit: 10,
  authWindowMs: 60_000,
  socketMessageLimit: 120,
  socketMessageWindowMs: 10_000,
  scryptN: 131_072,
  scryptR: 8,
  scryptP: 1,
};

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) {
    throw new Error(`Invalid positive integer for ${name}`);
  }
  return number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const config: ServerConfig = {
    ...defaultConfig,
    host: env.HOST ?? defaultConfig.host,
    port: positiveInt(env.PORT, defaultConfig.port, 'PORT'),
    databasePath: env.DATABASE_PATH ?? defaultConfig.databasePath,
    databaseUrl: env.DATABASE_URL,
    databaseSslMode: (env.DATABASE_SSL_MODE ?? 'verify-full') as ServerConfig['databaseSslMode'],
    databaseSslCaFile: env.DATABASE_SSL_CA_FILE,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    allowLocalhostOrigins: env.DEV_ALLOW_LOCALHOST_ORIGINS === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    maxConnections: positiveInt(env.MAX_CONNECTIONS, defaultConfig.maxConnections, 'MAX_CONNECTIONS'),
    maxConnectionsPerIp: positiveInt(env.MAX_CONNECTIONS_PER_IP, defaultConfig.maxConnectionsPerIp, 'MAX_CONNECTIONS_PER_IP'),
    maxRooms: positiveInt(env.MAX_ROOMS, defaultConfig.maxRooms, 'MAX_ROOMS'),
    maxRegisteredDevices: positiveInt(env.MAX_REGISTERED_DEVICES, defaultConfig.maxRegisteredDevices, 'MAX_REGISTERED_DEVICES'),
  };
  if (config.databaseUrl !== undefined) validatePostgresConfig({ ...config, databaseUrl: config.databaseUrl });
  else if (env.DATABASE_SSL_MODE || env.DATABASE_SSL_CA_FILE) throw new Error('Database TLS configuration requires DATABASE_URL.');
  for (const origin of config.allowedOrigins) {
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      throw new Error('ALLOWED_ORIGINS must contain exact Chrome/Edge extension origins');
    }
  }
  if (config.allowedOrigins.length === 0 && !config.allowLocalhostOrigins) {
    throw new Error('Configure ALLOWED_ORIGINS with the installed extension IDs');
  }
  if (config.port > 65_535) throw new Error('PORT must be at most 65535');
  return config;
}
