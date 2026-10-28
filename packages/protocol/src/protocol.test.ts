import { createHmac, hkdfSync, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VisualPreferencesSchema, PasswordSchema, ClientSignalMessageSchema, ControlCommandSchema, SettingsSchema, isRelaySignal, isSupportedUrl, normalizePageUrl, validateSignalingUrl, validateSignalingOrigin, extractSdpFingerprints, deriveSessionKeys, signSdpFingerprint, verifySdpFingerprint, generateSessionSalt, SessionSaltSchema, ServerSignalMessageSchema, KDF_ITERATIONS, PROTOCOL_VERSION, MIN_SUPPORTED_PROTOCOL_VERSION, isCompatibleProtocol } from './index';
describe('network boundaries', () => {
  it('requires an explicit boolean to enable legacy compatibility and keeps existing settings unchanged', () => {
    const settings = { signalingUrl: 'https://connect.example.com', stunUrls: ['stun:example.com:3478'] };
    expect(SettingsSchema.parse(settings)).toEqual(settings);
    expect(SettingsSchema.parse({ ...settings, legacyCompatibility: true }).legacyCompatibility).toBe(true);
    for (const legacyCompatibility of ['true', 1, null]) expect(SettingsSchema.safeParse({ ...settings, legacyCompatibility }).success).toBe(false);
  });
  it('accepts the supported wire range independently of product versions without guessing future protocols', () => {
    expect(MIN_SUPPORTED_PROTOCOL_VERSION).toBeLessThanOrEqual(PROTOCOL_VERSION);
    for (let protocol = MIN_SUPPORTED_PROTOCOL_VERSION; protocol <= PROTOCOL_VERSION; protocol++) expect(isCompatibleProtocol(protocol)).toBe(true);
    for (const protocol of [MIN_SUPPORTED_PROTOCOL_VERSION - 1, PROTOCOL_VERSION + 1, 6.5, '6', undefined, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isCompatibleProtocol(protocol)).toBe(false);
    }
  });
  it('migrates click animations on by default and preserves an explicit opt-out', () => {
    for (const saved of [{}, { notices: true, duration: 'temporary', seconds: 4 }, { text: { seconds: 10 }, other: { seconds: 3 } }]) {
      expect(VisualPreferencesSchema.parse(saved).clickAnimations).toBe(true);
      expect(VisualPreferencesSchema.parse(saved).showInteractions).toBe(true);
      expect(VisualPreferencesSchema.parse(saved).showHostPanel).toBe(true);
      expect(VisualPreferencesSchema.parse({ ...saved, showHostPanel: false }).showHostPanel).toBe(false);
      expect(VisualPreferencesSchema.parse({ ...saved, showInteractions: false }).showInteractions).toBe(false);
      expect(VisualPreferencesSchema.parse({ ...saved, clickAnimations: false }).clickAnimations).toBe(false);
    }
    for (const clickAnimations of ['false', 0, null]) expect(VisualPreferencesSchema.safeParse({ clickAnimations }).success).toBe(false);
    for (const showInteractions of ['false', 0, null]) expect(VisualPreferencesSchema.safeParse({ showInteractions }).success).toBe(false);
    for (const showHostPanel of ['false', 0, null]) expect(VisualPreferencesSchema.safeParse({ showHostPanel }).success).toBe(false);
  });
  it('defaults to half-second previews and bounds their configurable lifetime', () => {
    expect(VisualPreferencesSchema.parse({})).toEqual({ notices: false, clickAnimations: true, showInteractions: true, showHostPanel: true, text: { duration: 'temporary', seconds: 0.5 }, other: { duration: 'temporary', seconds: 0.5 }, accentColor: '#7871e8' });
    expect(VisualPreferencesSchema.parse({ text: { duration: 'persistent' }, other: {} })).toMatchObject({ text: { duration: 'persistent', seconds: 0.5 }, other: { duration: 'temporary', seconds: 0.5 } });
    for (let tenths = 1; tenths <= 100; tenths++) expect(VisualPreferencesSchema.safeParse({ text: { seconds: tenths / 10 }, other: { seconds: tenths / 10 } }).success).toBe(true);
    for (const seconds of [-1, 0, 0.01, 0.25, 10.1, 12, 30, Infinity, NaN]) expect(VisualPreferencesSchema.safeParse({ text: { seconds } }).success).toBe(false);
    expect(ControlCommandSchema.safeParse({ type: 'tab.create', url: 'https://example.com' }).success).toBe(false);
  });
  it('defaults legacy preferences to purple and accepts only opaque hex accents', () => {
    expect(VisualPreferencesSchema.parse({ notices: true, duration: 'temporary', seconds: 0.5 }).accentColor).toBe('#7871e8');
    for (const accentColor of ['#7871e8', '#3b82f6', '#22c55e', '#f97316', '#ec4899', '#ABCDEF']) {
      expect(VisualPreferencesSchema.parse({ accentColor }).accentColor).toBe(accentColor.toLowerCase());
    }
    for (const accentColor of ['', 'red', '#fff', '#00000000', 'var(--page-color)']) expect(VisualPreferencesSchema.safeParse({ accentColor }).success).toBe(false);
  });
  it('accepts human passwords of 8 through 256 characters and never lets them reach signaling', () => {
    for (const length of [7, 8, 12, 256, 257]) {
      const password = 'x'.repeat(length);
      expect(PasswordSchema.safeParse(password).success).toBe(length >= 8 && length <= 256);
      // Signaling only accepts the client-derived 256-bit token in the password field.
      expect(ClientSignalMessageSchema.safeParse({ type: 'host.open', protocol: PROTOCOL_VERSION, deviceId: 'a'.repeat(32), ownerToken: 'b'.repeat(64), salt: 'c'.repeat(32), password }).success).toBe(false);
      expect(ClientSignalMessageSchema.safeParse({ type: 'guest.join', protocol: PROTOCOL_VERSION, deviceId: 'a'.repeat(32), password }).success).toBe(false);
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
    const settings = { stunUrls: ['stun:example.com:3478'] };
    for (const signalingUrl of ['http://192.168.1.2:8787', 'https://example.com?token=secret', 'https://example.com#fragment', 'https://u:p@example.com', 'ftp://localhost']) {
      expect(validateSignalingUrl(signalingUrl)).toBe(false);
      expect(SettingsSchema.safeParse({ ...settings, signalingUrl }).success).toBe(false);
    }
    for (const signalingUrl of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787', 'https://example.com']) {
      expect(validateSignalingUrl(signalingUrl)).toBe(true);
      expect(SettingsSchema.parse({ ...settings, signalingUrl }).signalingUrl).toBe(signalingUrl);
    }
    expect(() => SettingsSchema.parse({ ...settings, signalingUrl: 'http://example.com' })).toThrow('Use HTTPS for signaling, or HTTP on localhost.');
  });

  it('normalizes page addresses consistently, including hosts with ports', () => {
    for (const address of ['example.com', 'example.com:8443/path?x=1#answer', 'localhost:8787', '127.0.0.1:8787/path', '[::1]:8787/path']) {
      expect(normalizePageUrl(` ${address} `)).toBe(`https://${address}`);
    }
    for (const address of ['http://localhost:8787/path', 'https://example.com:8443/path']) expect(normalizePageUrl(address)).toBe(address);
    for (const address of ['', ' ', 'javascript:alert(1)', 'javascript:80', 'data:text/html,test', 'file:///c:/test', 'ftp://example.com', 'https://user:secret@example.com', 'user:secret@example.com', 'chromewebstore.google.com/detail/test', 'https://microsoftedge.microsoft.com/addons/detail/test', 'localhost:99999', `https://example.com/${'x'.repeat(8192)}`]) {
      expect(() => normalizePageUrl(address), address).toThrow('Enter an HTTP or HTTPS page address.');
    }
  });

  it('requires origins for new signaling use while retaining readable legacy settings', () => {
    for (const signalingUrl of ['https://example.com', 'https://example.com/', 'https://example.com:8443', 'http://localhost:8787', 'http://127.0.0.1:8787/', 'http://[::1]:8787']) expect(validateSignalingOrigin(signalingUrl), signalingUrl).toBe(true);
    for (const signalingUrl of ['https://example.com/ghostpair', 'https://example.com/ghostpair/', 'https://example.com/?token=secret', 'https://example.com/#fragment', 'https://user:secret@example.com', 'http://example.com', 'invalid']) expect(validateSignalingOrigin(signalingUrl), signalingUrl).toBe(false);
    const settings = { signalingUrl: 'https://example.com/ghostpair', stunUrls: ['stun:example.com'] };
    expect(SettingsSchema.parse(settings)).toEqual(settings);
  });

  it('extracts canonical DTLS fingerprints and rejects malformed SDP', () => {
    const fpA = 'AA:'.repeat(31) + '01';
    const validSdp = `v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 ${fpA.toLowerCase()}\r\n`;
    expect(extractSdpFingerprints(validSdp)).toEqual([`sha-256 ${fpA}`]);
    for (const invalid of ['', 'a=fingerprint:sha-256 ' + fpA, `v=0\r\na=fingerprint:sha-1 ${'AA:'.repeat(19)}AA\r\n`, `v=0\r\na=fingerprint:sha-256 AA:BB\r\n`, `v=0\r\na=fingerprint:sha-256 ${fpA}\r\na=fingerprint:md5 invalid\r\n`, `v=0\r\n\0a=fingerprint:sha-256 ${fpA}`]) {
      expect(extractSdpFingerprints(invalid)).toEqual([]);
    }
  });

  describe('session key derivation and SDP authentication', () => {
    const fpA = 'AA:'.repeat(31) + '01';
    const fpB = 'BB:'.repeat(31) + '02';
    const fpC = 'CC:'.repeat(31) + '03';
    const sdp = (fingerprint: string) => `v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 ${fingerprint}\r\n`;
    const offerSdp = sdp(fpA), answerSdp = sdp(fpB);
    const deviceId = 'a'.repeat(32), sessionId = 'c'.repeat(32), salt = '0123456789abcdef0123456789abcdef';
    const iterations = 1_000;

    it('matches an independent node:crypto implementation (known answer)', async () => {
      const keys = await deriveSessionKeys('Shared-Secret-99', deviceId, salt, iterations);
      const master = pbkdf2Sync(Buffer.from('Shared-Secret-99'.normalize('NFKC')), `ghostpair:kdf:v2|${deviceId}|${salt}`, iterations, 32, 'sha256');
      const expand = (label: string) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `ghostpair:${label}:v2|${deviceId}`, 32));
      expect(keys.authToken).toBe(expand('signaling-auth').toString('hex'));
      const macKey = expand('e2e-sdp-mac');
      expect(await signSdpFingerprint(keys.macKey, sessionId, 'host', offerSdp, undefined))
        .toBe(createHmac('sha256', macKey).update(`ghostpair:sdp-fp:v2|${sessionId}|host|sha-256 ${fpA}`).digest('hex'));
      expect(await signSdpFingerprint(keys.macKey, sessionId, 'guest', answerSdp, offerSdp))
        .toBe(createHmac('sha256', macKey).update(`ghostpair:sdp-fp:v2|${sessionId}|guest|sha-256 ${fpB}|sha-256 ${fpA}`).digest('hex'));
      expect(keys.authToken).not.toBe(macKey.toString('hex'));
    });

    it('is deterministic per password, device and salt and sensitive to each of them', async () => {
      const base = await deriveSessionKeys('Shared-Secret-99', deviceId, salt, iterations);
      const upper = await deriveSessionKeys('Shared-Secret-99', deviceId.toUpperCase(), salt, iterations);
      expect(upper.authToken).toBe(base.authToken);
      expect(base.authToken).toMatch(/^[a-f0-9]{64}$/);
      for (const other of [
        await deriveSessionKeys('Wrong-Secret-99', deviceId, salt, iterations),
        await deriveSessionKeys('Shared-Secret-99', 'b'.repeat(32), salt, iterations),
        await deriveSessionKeys('Shared-Secret-99', deviceId, 'f'.repeat(32), iterations),
      ]) expect(other.authToken).not.toBe(base.authToken);
      await expect(deriveSessionKeys('Shared-Secret-99', deviceId, 'not-a-salt', iterations)).rejects.toThrow('Invalid session salt.');
    });

    it('keeps the MAC key non-extractable and generates unique salts', async () => {
      const { macKey } = await deriveSessionKeys('Shared-Secret-99', deviceId, salt, iterations);
      expect(macKey.extractable).toBe(false);
      await expect(crypto.subtle.exportKey('raw', macKey)).rejects.toThrow();
      const salts = new Set(Array.from({ length: 20 }, generateSessionSalt));
      expect(salts.size).toBe(20);
      for (const value of salts) expect(SessionSaltSchema.safeParse(value).success).toBe(true);
    });

    it('authenticates offers and answers end to end and rejects any binding change', async () => {
      const host = await deriveSessionKeys('Shared-Secret-99', deviceId, salt, iterations);
      const guest = await deriveSessionKeys('Shared-Secret-99', deviceId.toUpperCase(), salt, iterations);
      const wrong = await deriveSessionKeys('Wrong-Secret-99', deviceId, salt, iterations);
      const offerMac = await signSdpFingerprint(host.macKey, sessionId, 'host', offerSdp);
      expect(await verifySdpFingerprint(guest.macKey, sessionId, 'host', offerSdp, offerMac)).toBe(true);
      expect(await verifySdpFingerprint(guest.macKey, sessionId, 'guest', offerSdp, offerMac, offerSdp)).toBe(false);
      expect(await verifySdpFingerprint(guest.macKey, 'd'.repeat(32), 'host', offerSdp, offerMac)).toBe(false);
      expect(await verifySdpFingerprint(wrong.macKey, sessionId, 'host', offerSdp, offerMac)).toBe(false);
      expect(await verifySdpFingerprint(guest.macKey, sessionId, 'host', sdp(fpB), offerMac)).toBe(false);
      for (const mac of [undefined, '', 'A'.repeat(64), 'a'.repeat(63)]) expect(await verifySdpFingerprint(guest.macKey, sessionId, 'host', offerSdp, mac)).toBe(false);

      const answerMac = await signSdpFingerprint(guest.macKey, sessionId, 'guest', answerSdp, offerSdp);
      expect(await verifySdpFingerprint(host.macKey, sessionId, 'guest', answerSdp, answerMac, offerSdp)).toBe(true);
      // The answer is bound to the offer it answered and cannot be replayed against another one.
      expect(await verifySdpFingerprint(host.macKey, sessionId, 'guest', answerSdp, answerMac, sdp(fpC))).toBe(false);
      expect(await verifySdpFingerprint(host.macKey, sessionId, 'guest', answerSdp, answerMac)).toBe(false);
      await expect(signSdpFingerprint(guest.macKey, sessionId, 'guest', answerSdp)).rejects.toThrow('bound to a valid offer');
      await expect(signSdpFingerprint(host.macKey, sessionId, 'host', 'v=0\r\n')).rejects.toThrow('valid DTLS fingerprint');
    });

    it('uses a deliberately expensive default work factor', () => {
      expect(KDF_ITERATIONS).toBe(600_000);
    });
  });

  it('validates the v6 handshake messages strictly', () => {
    const token = 'a'.repeat(64), deviceId = 'b'.repeat(32), salt = 'c'.repeat(32);
    expect(ClientSignalMessageSchema.safeParse({ type: 'host.open', protocol: PROTOCOL_VERSION, deviceId, ownerToken: token, salt, password: token }).success).toBe(true);
    expect(ClientSignalMessageSchema.safeParse({ type: 'guest.challenge', protocol: PROTOCOL_VERSION, deviceId }).success).toBe(true);
    expect(ClientSignalMessageSchema.safeParse({ type: 'guest.join', protocol: PROTOCOL_VERSION, deviceId, password: token }).success).toBe(true);
    // A human password, a malformed identifier or a missing protocol never reaches the server logic.
    expect(ClientSignalMessageSchema.safeParse({ type: 'guest.join', protocol: PROTOCOL_VERSION, deviceId, password: 'Eight-42' }).success).toBe(false);
    expect(ClientSignalMessageSchema.safeParse({ type: 'guest.join', protocol: PROTOCOL_VERSION, deviceId: 'B'.repeat(32), password: token }).success).toBe(false);
    expect(ClientSignalMessageSchema.safeParse({ type: 'guest.join', deviceId, password: token }).success).toBe(false);
    expect(ClientSignalMessageSchema.safeParse({ type: 'host.open', protocol: PROTOCOL_VERSION, deviceId, ownerToken: 'short', salt, password: token }).success).toBe(false);
    expect(ClientSignalMessageSchema.safeParse({ type: 'host.open', protocol: PROTOCOL_VERSION, deviceId, ownerToken: token, salt: 'zz', password: token }).success).toBe(false);
    expect(ServerSignalMessageSchema.safeParse({ type: 'guest.salt', deviceId, salt }).success).toBe(true);
  });
});
