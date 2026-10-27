import { z } from 'zod';

export const PROTOCOL_VERSION = 5;
export const MAX_CLIPBOARD_BYTES = 256 * 1024;

const id = z.string().min(1).max(128).refine(value => !value.includes('\0'), 'Invalid identifier.');
export const HexDeviceIdSchema = z.string().regex(/^[a-f0-9]{32}$/, 'Invalid device identifier.');
export const HexTokenSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Invalid security token.');
export const MIN_PASSWORD_LENGTH = 8;
export const PasswordSchema = z.string().min(MIN_PASSWORD_LENGTH, 'Use at least 8 characters.').max(256);
export const IceCandidateSchema = z.object({
  candidate: z.string().max(8192).refine(value => !value.includes('\0'), 'Invalid ICE candidate.').optional(),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict();
const SdpSchema = z.string().min(1).max(60000).refine(value => !value.includes('\0'), 'Invalid SDP.');
export const SignalPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), sdp: SdpSchema, mac: HexTokenSchema.optional() }).strict(),
  z.object({ type: z.literal('answer'), sdp: SdpSchema, mac: HexTokenSchema.optional() }).strict(),
  z.object({ type: z.literal('ice'), candidate: IceCandidateSchema.nullable() }).strict(),
]);
export const ClientSignalMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('host.open'), deviceId: id, ownerToken: z.string().min(1).max(256), password: PasswordSchema }).strict(),
  z.object({ type: z.literal('guest.join'), deviceId: id, password: PasswordSchema }).strict(),
  z.object({ type: z.literal('signal'), sessionId: id, payload: SignalPayloadSchema }).strict(),
  z.object({ type: z.literal('host.close'), sessionId: id }).strict(),
  z.object({ type: z.literal('ping'), id: z.string().max(64) }).strict(),
]);
export const ServerSignalMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('host.ready'), deviceId: id, sessionId: id }).strict(),
  z.object({ type: z.literal('paired'), sessionId: id, role: z.enum(['host', 'guest']) }).strict(),
  z.object({ type: z.literal('signal'), sessionId: id, payload: SignalPayloadSchema }).strict(),
  z.object({ type: z.literal('ended'), sessionId: id, reason: z.string().max(256) }).strict(),
  z.object({ type: z.literal('error'), code: z.string().max(64), message: z.string().max(256) }).strict(),
  z.object({ type: z.literal('pong'), id: z.string().max(64) }).strict(),
]);
export type ClientSignalMessage = z.infer<typeof ClientSignalMessageSchema>;
export type ServerSignalMessage = z.infer<typeof ServerSignalMessageSchema>;
export type SignalPayload = z.infer<typeof SignalPayloadSchema>;

export const SettingsSchema = z.object({
  signalingUrl: z.string().url().refine(validateSignalingUrl, 'Use HTTPS for signaling, or HTTP on localhost.'),
  stunUrls: z.array(z.string().regex(/^stuns?:[^\s]+$/i, 'Only STUN servers are supported.')).min(1).max(5),
}).strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const VisualSecondsSchema = z.number().finite().min(0.1).max(10).multipleOf(0.1);
export const VisualLifetimeSchema = z.object({
  duration: z.enum(['persistent', 'temporary']).default('temporary'),
  seconds: VisualSecondsSchema.default(0.5),
}).strict();
export const VisualPreferencesSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const saved = value as Record<string, unknown>;
  if (('duration' in saved || 'seconds' in saved) && !('text' in saved || 'other' in saved)) {
    const { duration = 'temporary', seconds = 0.5, ...rest } = saved;
    return { ...rest, text: { duration, seconds }, other: { duration, seconds } };
  }
  return value;
}, z.object({
  notices: z.boolean().default(false),
  clickAnimations: z.boolean().default(true),
  showInteractions: z.boolean().default(true),
  showHostPanel: z.boolean().default(true),
  text: VisualLifetimeSchema.default({ duration: 'temporary', seconds: 0.5 }),
  other: VisualLifetimeSchema.default({ duration: 'temporary', seconds: 0.5 }),
  accentColor: z.string().regex(/^#[\da-f]{6}$/i, 'Choose a six-digit hex color.').transform(value => value.toLowerCase()).default('#7871e8'),
}).strict());
export type VisualPreferences = z.infer<typeof VisualPreferencesSchema>;
export type VisualCategory = 'text' | 'other';
export interface VisualActivity { category: VisualCategory; kind: 'focus' | 'click' | 'typing' }
export const ControlModeSchema = z.enum(['visual', 'live']);
export type ControlMode = z.infer<typeof ControlModeSchema>;
export interface ControlConfiguration { mode: ControlMode; revision: number; preferences: VisualPreferences }
export const PresentationSchema = z.object({
  captureId: z.string().min(1).max(128), tabId: z.number().int().nonnegative(), documentId: z.string().min(1).max(128), generation: z.number().int().nonnegative(),
  viewportWidth: z.number().finite().positive().max(32768), viewportHeight: z.number().finite().positive().max(32768),
  offsetLeft: z.number().finite().min(0).max(32768), offsetTop: z.number().finite().min(0).max(32768), scale: z.number().finite().positive().max(100),
}).strict();
export type Presentation = z.infer<typeof PresentationSchema>;
export const MediaSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('media.reset'), generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('media.signal'), generation: z.number().int().nonnegative(), payload: SignalPayloadSchema, presentation: PresentationSchema.optional() }).strict(),
]);
export type MediaSignal = z.infer<typeof MediaSignalSchema>;
export interface TabInfo { id: number; title: string; url: string; active: boolean; supported: boolean; authorized?: boolean; captureState?: 'pending' | 'ready' | 'unavailable' }
export type Locale = 'en' | 'es';
export type LanguagePreference = 'auto' | Locale;
export interface AppState {
  languagePreference: LanguagePreference;
  locale: Locale;
  role: 'host' | 'guest' | null;
  status: 'idle' | 'starting' | 'waiting' | 'connecting' | 'connected' | 'paused' | 'error';
  deviceId?: string;
  sessionId?: string;
  error?: string;
  notice?: string;
  notification?: { id: string; kind: 'error' | 'notice'; message: string };
  presentation?: Presentation;
  paused: boolean;
  controlEnabled: boolean;
  controlMode: ControlMode;
  controlRevision: number;
  visualPreferences: VisualPreferences;
  clipboardEnabled: boolean;
  remoteClipboardEnabled: boolean;
  tabs: TabInfo[];
  activeTabId?: number;
  generation: number;
  settings: Settings;
}

const revision = { controlRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) };
const target = { ...revision, tabId: z.number().int().min(0), generation: z.number().int().min(0), captureId: z.string().min(1).max(128), documentId: z.string().min(1).max(128) };
const coords = { x: z.number().finite().min(0).max(32768), y: z.number().finite().min(0).max(32768) };
export const ControlCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input.release'), ...target }).strict(),
  z.object({ type: z.literal('pointer'), ...target, ...coords, event: z.enum(['move', 'down', 'up']), button: z.enum(['left', 'middle', 'right']).default('left'), buttons: z.number().int().min(0).max(7).default(0), modifiers: z.number().int().min(0).max(15).default(0), clickCount: z.number().int().min(0).max(3).default(1) }).strict(),
  z.object({ type: z.literal('wheel'), ...target, ...coords, deltaX: z.number().finite().min(-10000).max(10000), deltaY: z.number().finite().min(-10000).max(10000), modifiers: z.number().int().min(0).max(15).default(0) }).strict(),
  z.object({ type: z.literal('key'), ...target, event: z.enum(['down', 'up']), key: z.string().max(64), code: z.string().max(64), keyCode: z.number().int().min(0).max(65535), modifiers: z.number().int().min(0).max(15).default(0), repeat: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('text'), ...target, text: z.string().max(MAX_CLIPBOARD_BYTES) }).strict(),
  z.object({ type: z.literal('tab.create'), ...revision, url: z.string().max(8192) }).strict(),
  z.object({ type: z.literal('tab.activate'), ...revision, tabId: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal('tab.close'), ...revision, tabId: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal('navigate'), ...target, url: z.string().max(8192) }).strict(),
  z.object({ type: z.literal('history'), ...target, direction: z.enum(['back', 'forward']) }).strict(),
  z.object({ type: z.literal('reload'), ...target }).strict(),
]);
export type ControlCommand = z.infer<typeof ControlCommandSchema>;

export function isRelaySignal(payload: SignalPayload): boolean {
  const text = payload.type === 'ice' ? payload.candidate?.candidate ?? '' : payload.sdp;
  return /\btyp\s+relay\b/i.test(text);
}

export function isSupportedUrl(url: string): boolean {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !['chromewebstore.google.com', 'microsoftedge.microsoft.com'].includes(parsed.hostname); }
  catch { return false; }
}

export function validateSignalingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

const FINGERPRINT_BYTES: Record<string, number> = { 'sha-256': 32, 'sha-384': 48, 'sha-512': 64 };
export function extractSdpFingerprints(sdp: string): string[] {
  if (!sdp || sdp.includes('\0') || !/(?:^|\r?\n)v=0(?:\r?\n|$)/.test(sdp)) return [];
  const found: string[] = [];
  for (const rawLine of sdp.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.toLowerCase().startsWith('a=fingerprint:')) continue;
    const match = /^a=fingerprint:(sha-256|sha-384|sha-512)\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2})+)$/i.exec(line);
    if (!match) return [];
    const alg = match[1]!.toLowerCase();
    const hex = match[2]!.toUpperCase();
    if (hex.split(':').length !== FINGERPRINT_BYTES[alg]) return [];
    const normalized = `${alg} ${hex}`;
    if (!found.includes(normalized)) found.push(normalized);
  }
  return found;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(input: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bitLen = input.length * 8;
  const paddedLen = ((input.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15]! >>> 7) | (w[i - 15]! << 25)) ^ ((w[i - 15]! >>> 18) | (w[i - 15]! << 14)) ^ (w[i - 15]! >>> 3);
      const s1 = ((w[i - 2]! >>> 17) | (w[i - 2]! << 15)) ^ ((w[i - 2]! >>> 19) | (w[i - 2]! << 13)) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => outView.setUint32(i * 4, word, false));
  return out;
}

function hmacSha256Bytes(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockKey = new Uint8Array(64);
  blockKey.set(key.length > 64 ? sha256Bytes(key) : key);
  const ipad = new Uint8Array(64 + message.length);
  const opad = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    ipad[i] = blockKey[i]! ^ 0x36;
    opad[i] = blockKey[i]! ^ 0x5c;
  }
  ipad.set(message, 64);
  opad.set(sha256Bytes(ipad), 64);
  return sha256Bytes(opad);
}

const utf8 = new TextEncoder();
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface SessionKeys { authToken: string; macKey: string }
export function deriveSessionKeys(password: string, deviceId: string): SessionKeys {
  const normalizedDevice = deviceId.trim().toLowerCase();
  const pwBytes = utf8.encode(password);
  let master = hmacSha256Bytes(pwBytes, utf8.encode(`ghostpair:session:v1|${normalizedDevice}`));
  for (let i = 0; i < 2048; i++) master = hmacSha256Bytes(pwBytes, master);
  const authToken = toHex(hmacSha256Bytes(master, utf8.encode(`ghostpair:signaling-auth:v1|${normalizedDevice}`)));
  const macKey = toHex(hmacSha256Bytes(master, utf8.encode(`ghostpair:e2e-sdp-mac:v1|${normalizedDevice}`)));
  master.fill(0);
  pwBytes.fill(0);
  return { authToken, macKey };
}

export function signSdpFingerprint(macKey: string, sessionId: string, role: 'host' | 'guest', sdp: string): string {
  const fingerprints = extractSdpFingerprints(sdp);
  if (!fingerprints.length) throw new Error('SDP does not contain a valid DTLS fingerprint.');
  const payload = utf8.encode(`ghostpair:sdp-fp:v1|${sessionId}|${role}|${fingerprints.join(',')}`);
  return toHex(hmacSha256Bytes(utf8.encode(macKey), payload));
}

export function verifySdpFingerprint(macKey: string, sessionId: string, role: 'host' | 'guest', sdp: string, mac?: string): boolean {
  if (typeof mac !== 'string' || !/^[a-f0-9]{64}$/.test(mac)) return false;
  const fingerprints = extractSdpFingerprints(sdp);
  if (!fingerprints.length) return false;
  const expected = signSdpFingerprint(macKey, sessionId, role, sdp);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  return diff === 0;
}
