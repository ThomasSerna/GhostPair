import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const MAX_CLIPBOARD_BYTES = 256 * 1024;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const MAX_SIGNAL_BYTES = 64 * 1024;

const id = z.string().min(1).max(128);
export const PasswordSchema = z.string().min(12, 'Usa al menos 12 caracteres.').max(256);
export const IceCandidateSchema = z.object({
  candidate: z.string().max(8192).optional(),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict();
export const SignalPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(60000) }).strict(),
  z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(60000) }).strict(),
  z.object({ type: z.literal('ice'), candidate: IceCandidateSchema.nullable() }).strict(),
]);
export const ClientSignalMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('host.open'), deviceId: id, ownerToken: z.string().min(1).max(256), password: PasswordSchema }).strict(),
  z.object({ type: z.literal('guest.join'), deviceId: id, password: z.string().min(1).max(256) }).strict(),
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
  signalingUrl: z.string().url(),
  stunUrls: z.array(z.string().regex(/^stuns?:[^\s]+$/i, 'Solo se admiten servidores STUN.')).min(1).max(5),
}).strict();
export type Settings = z.infer<typeof SettingsSchema>;
export interface TabInfo { id: number; title: string; url: string; active: boolean; supported: boolean }
export interface AppState {
  role: 'host' | 'guest' | null;
  status: 'idle' | 'starting' | 'waiting' | 'connecting' | 'connected' | 'paused' | 'error';
  deviceId?: string;
  sessionId?: string;
  error?: string;
  notice?: string;
  paused: boolean;
  controlEnabled: boolean;
  clipboardEnabled: boolean;
  remoteClipboardEnabled: boolean;
  tabs: TabInfo[];
  activeTabId?: number;
  generation: number;
  settings: Settings;
  connection?: { direct: boolean; latencyMs?: number; framesPerSecond?: number };
}

const target = { tabId: z.number().int().min(0), generation: z.number().int().min(0) };
const coords = { x: z.number().finite().min(0).max(32768), y: z.number().finite().min(0).max(32768) };
export const ControlCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pointer'), ...target, ...coords, event: z.enum(['move', 'down', 'up']), button: z.enum(['left', 'middle', 'right']).default('left'), buttons: z.number().int().min(0).max(7).default(0), modifiers: z.number().int().min(0).max(15).default(0), clickCount: z.number().int().min(0).max(3).default(1) }).strict(),
  z.object({ type: z.literal('wheel'), ...target, ...coords, deltaX: z.number().finite().min(-10000).max(10000), deltaY: z.number().finite().min(-10000).max(10000), modifiers: z.number().int().min(0).max(15).default(0) }).strict(),
  z.object({ type: z.literal('key'), ...target, event: z.enum(['down', 'up']), key: z.string().max(64), code: z.string().max(64), keyCode: z.number().int().min(0).max(65535), modifiers: z.number().int().min(0).max(15).default(0), repeat: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('text'), ...target, text: z.string().max(MAX_CLIPBOARD_BYTES) }).strict(),
  z.object({ type: z.literal('tab.create'), url: z.string().max(8192) }).strict(),
  z.object({ type: z.literal('tab.activate'), tabId: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal('tab.close'), tabId: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal('navigate'), ...target, url: z.string().max(8192) }).strict(),
  z.object({ type: z.literal('history'), ...target, direction: z.enum(['back', 'forward']) }).strict(),
  z.object({ type: z.literal('reload'), ...target }).strict(),
]);
export type ControlCommand = z.infer<typeof ControlCommandSchema>;

export const FrameMetaSchema = z.object({
  frameId: z.number().int().nonnegative(),
  tabId: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  width: z.number().int().min(1).max(1920),
  height: z.number().int().min(1).max(1920),
  viewportWidth: z.number().finite().min(1).max(32768),
  viewportHeight: z.number().finite().min(1).max(32768),
  offsetTop: z.number().finite().min(-32768).max(32768),
  pageScaleFactor: z.number().finite().positive().max(100),
  timestamp: z.number().finite().nonnegative(),
}).strict();
export type FrameMeta = z.infer<typeof FrameMetaSchema>;
export interface ViewerFrame { dataUrl: string; meta: FrameMeta }

export const ClipboardUpdateSchema = z.object({
  type: z.literal('clipboard.update'),
  text: z.string().max(MAX_CLIPBOARD_BYTES),
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  origin: z.enum(['host', 'guest']),
}).strict().refine(v => new TextEncoder().encode(v.text).byteLength <= MAX_CLIPBOARD_BYTES, 'Clipboard exceeds limit');
export type ClipboardUpdate = z.infer<typeof ClipboardUpdateSchema>;

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
