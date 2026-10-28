import { z } from 'zod';

export const PROTOCOL_VERSION = 6;
// Routine releases keep the v6 wire format; only a breaking change raises this floor.
export const MIN_SUPPORTED_PROTOCOL_VERSION = 6;
export function isCompatibleProtocol(protocol: unknown): protocol is number {
  return typeof protocol === 'number' && Number.isSafeInteger(protocol) && protocol >= MIN_SUPPORTED_PROTOCOL_VERSION && protocol <= PROTOCOL_VERSION;
}
export const MAX_CLIPBOARD_BYTES = 256 * 1024;

const id = z.string().min(1).max(128).refine(value => !value.includes('\0'), 'Invalid identifier.');
export const HexDeviceIdSchema = z.string().regex(/^[a-f0-9]{32}$/, 'Invalid device identifier.');
export const HexTokenSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Invalid security token.');
export const SessionSaltSchema = z.string().regex(/^[a-f0-9]{32}$/, 'Invalid session salt.');
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
  // `password` carries the client-derived authentication token, never the human password.
  z.object({ type: z.literal('host.open'), protocol: z.number().int(), deviceId: HexDeviceIdSchema, ownerToken: HexTokenSchema, salt: SessionSaltSchema, password: HexTokenSchema }).strict(),
  z.object({ type: z.literal('guest.challenge'), protocol: z.number().int(), deviceId: HexDeviceIdSchema }).strict(),
  z.object({ type: z.literal('guest.join'), protocol: z.number().int(), deviceId: HexDeviceIdSchema, password: HexTokenSchema }).strict(),
  z.object({ type: z.literal('signal'), sessionId: id, payload: SignalPayloadSchema }).strict(),
  z.object({ type: z.literal('host.close'), sessionId: id }).strict(),
  z.object({ type: z.literal('ping'), id: z.string().max(64) }).strict(),
]);
export const ServerSignalMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('host.ready'), deviceId: id, sessionId: id }).strict(),
  z.object({ type: z.literal('guest.salt'), deviceId: id, salt: SessionSaltSchema }).strict(),
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
  legacyCompatibility: z.boolean().optional(),
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

export function normalizePageUrl(value: string): string {
  const address = value.trim();
  const hostWithPort = /^(?:localhost|[^/?#:@]+\.[^/?#:@]+|\[[\da-f:.]+\]):\d+(?:[/?#]|$)/i.test(address);
  const url = /^[a-z][a-z\d+.-]*:/i.test(address) && !hostWithPort ? address : `https://${address}`;
  if (!address || url.length > 8192 || !isSupportedUrl(url)) throw new Error('Enter an HTTP or HTTPS page address.');
  return url;
}

export function validateSignalingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

export const SIGNALING_ORIGIN_ERROR = 'Use a connection server origin without a path. Edit Connection settings before starting a session.';
export function validateSignalingOrigin(value: string): boolean {
  return validateSignalingUrl(value) && new URL(value).pathname === '/';
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


export const KDF_ITERATIONS = 600_000;
const SESSION_SALT_BYTES = 16;
const utf8 = new TextEncoder();

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('Web Crypto is unavailable.');
  return api;
}
function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Public random value that makes every session's derived keys unique. */
export function generateSessionSalt(): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(SESSION_SALT_BYTES)));
}

export interface SessionKeys {
  /** Sent to signaling so it can gate pairing; independent from `macKey`. */
  authToken: string;
  /** Never leaves the client and cannot be exported from the Web Crypto key. */
  macKey: CryptoKey;
}

/**
 * Stretches the human password once with PBKDF2 and expands it into two
 * domain-separated keys with HKDF, using only Web Crypto primitives.
 */
export async function deriveSessionKeys(password: string, deviceId: string, salt: string, iterations = KDF_ITERATIONS): Promise<SessionKeys> {
  if (!SessionSaltSchema.safeParse(salt).success) throw new Error('Invalid session salt.');
  const device = deviceId.trim().toLowerCase();
  const passwordKey = await subtle().importKey('raw', utf8.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const masterBits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8.encode(`ghostpair:kdf:v2|${device}|${salt}`), iterations }, passwordKey, 256);
  const master = await subtle().importKey('raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  new Uint8Array(masterBits).fill(0);
  const hkdf = (label: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(`ghostpair:${label}:v2|${device}`) });
  const authToken = toHex(await subtle().deriveBits(hkdf('signaling-auth'), master, 256));
  const macKey = await subtle().deriveKey(hkdf('e2e-sdp-mac'), master, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
  return { authToken, macKey };
}

/**
 * The host signs its own DTLS fingerprints. The guest also signs the offer's
 * fingerprints it accepted, so an answer cannot be replayed against another offer.
 */
function macTranscript(sessionId: string, role: 'host' | 'guest', sdp: string, offerSdp?: string): Uint8Array<ArrayBuffer> {
  const fingerprints = extractSdpFingerprints(sdp);
  if (!fingerprints.length) throw new Error('SDP does not contain a valid DTLS fingerprint.');
  let text = `ghostpair:sdp-fp:v2|${sessionId}|${role}|${fingerprints.join(',')}`;
  if (role === 'guest') {
    const offered = offerSdp ? extractSdpFingerprints(offerSdp) : [];
    if (!offered.length) throw new Error('An answer must be bound to a valid offer.');
    text += `|${offered.join(',')}`;
  }
  return new Uint8Array(utf8.encode(text));
}

export async function signSdpFingerprint(macKey: CryptoKey, sessionId: string, role: 'host' | 'guest', sdp: string, offerSdp?: string): Promise<string> {
  return toHex(await subtle().sign('HMAC', macKey, macTranscript(sessionId, role, sdp, offerSdp)));
}

export async function verifySdpFingerprint(macKey: CryptoKey, sessionId: string, role: 'host' | 'guest', sdp: string, mac?: string, offerSdp?: string): Promise<boolean> {
  if (typeof mac !== 'string' || !/^[a-f0-9]{64}$/.test(mac)) return false;
  try { return await subtle().verify('HMAC', macKey, fromHex(mac), macTranscript(sessionId, role, sdp, offerSdp)); }
  catch { return false; }
}
