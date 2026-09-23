import { describe, expect, it } from 'vitest';
import { VisualPreferencesSchema, PasswordSchema, ClientSignalMessageSchema, ControlCommandSchema, isRelaySignal, isSupportedUrl, validateSignalingUrl } from './index';
describe('network boundaries', () => {
  it('migrates click animations on by default and preserves an explicit opt-out', () => {
    for (const saved of [{}, { notices: true, duration: 'temporary', seconds: 4 }, { text: { seconds: 10 }, other: { seconds: 3 } }]) {
      expect(VisualPreferencesSchema.parse(saved).clickAnimations).toBe(true);
      expect(VisualPreferencesSchema.parse({ ...saved, clickAnimations: false }).clickAnimations).toBe(false);
    }
    for (const clickAnimations of ['false', 0, null]) expect(VisualPreferencesSchema.safeParse({ clickAnimations }).success).toBe(false);
  });
  it('defaults to silent persistent previews and bounds their configurable lifetime', () => {
    expect(VisualPreferencesSchema.parse({})).toEqual({ notices: false, clickAnimations: true, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 }, accentColor: '#7871e8' });
    for (let tenths = 1; tenths <= 300; tenths++) expect(VisualPreferencesSchema.safeParse({ text: { seconds: tenths / 10 }, other: { seconds: tenths / 10 } }).success).toBe(true);
    for (const seconds of [-1, 0, 0.01, 0.25, 30.1, 31, Infinity, NaN]) expect(VisualPreferencesSchema.safeParse({ text: { seconds } }).success).toBe(false);
    expect(ControlCommandSchema.safeParse({ type: 'tab.create', url: 'https://example.com' }).success).toBe(false);
  });
  it('defaults legacy preferences to purple and accepts only opaque hex accents', () => {
    expect(VisualPreferencesSchema.parse({ notices: true, duration: 'temporary', seconds: 0.5 }).accentColor).toBe('#7871e8');
    for (const accentColor of ['#7871e8', '#3b82f6', '#22c55e', '#f97316', '#ec4899', '#ABCDEF']) {
      expect(VisualPreferencesSchema.parse({ accentColor }).accentColor).toBe(accentColor.toLowerCase());
    }
    for (const accentColor of ['', 'red', '#fff', '#00000000', 'var(--page-color)']) expect(VisualPreferencesSchema.safeParse({ accentColor }).success).toBe(false);
  });
  it('accepts passwords of 8 through 256 characters in both roles', () => {
    for (const length of [7, 8, 12, 256, 257]) {
      const password = 'x'.repeat(length);
      const valid = length >= 8 && length <= 256;
      expect(PasswordSchema.safeParse(password).success).toBe(valid);
      expect(ClientSignalMessageSchema.safeParse({ type: 'host.open', deviceId: 'device', ownerToken: 'token', password }).success).toBe(valid);
      expect(ClientSignalMessageSchema.safeParse({ type: 'guest.join', deviceId: 'device', password }).success).toBe(valid);
    }
  });
  it('accepts only specific control operations and finite coordinates', () => {
    expect(ControlCommandSchema.safeParse({ type: 'Runtime.evaluate', expression: 'alert(1)' }).success).toBe(false);
    expect(ControlCommandSchema.safeParse({ type: 'pointer', controlRevision: 0, event: 'down', x: Infinity, y: 0, tabId: 1, generation: 1 }).success).toBe(false);
    expect(ControlCommandSchema.safeParse({ type: 'tab.create', controlRevision: 0, url: 'https://example.com', extra: true }).success).toBe(false);
  });
  it('requires a complete document-scoped release command', () => {
    const release = { type: 'input.release', controlRevision: 0, tabId: 1, captureId: 'capture', documentId: 'document', generation: 3 };
    expect(ControlCommandSchema.safeParse(release).success).toBe(true);
    expect(ControlCommandSchema.safeParse({ type: 'input.release', controlRevision: 0, tabId: 1 }).success).toBe(false);
    expect(ControlCommandSchema.safeParse({ ...release, x: 0 }).success).toBe(false);
  });
  it('rejects relay candidates in SDP and trickle ICE', () => {
    expect(isRelaySignal({ type: 'ice', candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 88 typ relay raddr 0.0.0.0' } })).toBe(true);
    expect(isRelaySignal({ type: 'offer', sdp: 'v=0\r\na=candidate:1 1 udp 2 1.2.3.4 33 typ relay\r\n' })).toBe(true);
    expect(isRelaySignal({ type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 192.168.1.2 33 typ host' } })).toBe(false);
  });
  it('allows only web targets and encrypted production signaling', () => {
    for (const url of ['chrome://settings', 'edge://extensions', 'file:///c:/x', 'javascript:alert(1)', 'https://chromewebstore.google.com/detail/a', 'https://u:p@example.com']) expect(isSupportedUrl(url)).toBe(false);
    expect(isSupportedUrl('https://example.com')).toBe(true);
    expect(validateSignalingUrl('http://192.168.1.2:8787')).toBe(false);
    expect(validateSignalingUrl('http://localhost:8787')).toBe(true);
    expect(validateSignalingUrl('https://example.com?token=secret')).toBe(false);
    expect(validateSignalingUrl('https://example.com')).toBe(true);
  });
});
