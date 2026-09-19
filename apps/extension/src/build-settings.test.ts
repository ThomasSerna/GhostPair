import { expect, it } from 'vitest';
import { buildSettings, validateStoreSettings } from '../build-settings.mjs';

it('keeps local defaults but rejects them for store packages', () => {
  expect(buildSettings({}).signalingUrl).toBe('http://127.0.0.1:8787');
  expect(() => validateStoreSettings(buildSettings({}))).toThrow('HTTPS');
});
it('rejects non-public, credentialed and placeholder build endpoints', () => {
  for (const signalingUrl of ['http://connect.ghostpair.dev', 'https://localhost', 'https://127.0.0.1', 'https://192.168.1.2', 'https://[::1]', 'https://signal.internal', 'https://connect.example.com', 'https://connect.yourdomain.com', 'https://router.home.arpa', 'https://foo.test', 'https://name:secret@connect.ghostpair.dev', 'https://connect.ghostpair.dev/path', 'https://connect.ghostpair.dev/?secret=value']) {
    expect(() => validateStoreSettings({ signalingUrl, stunUrls: ['stun:stun.l.google.com:19302'] })).toThrow();
  }
  for (const stunUrls of [[], ['turn:relay.ghostpair.dev'], ['stun:localhost'], ['stun:example.com'], ['stun:stun.ghostpair.dev:99999']]) expect(() => validateStoreSettings({ signalingUrl: 'https://connect.ghostpair.dev', stunUrls })).toThrow();
});
it('validates the resolved public settings, including normalized STUN lists', () => {
  const settings = buildSettings({ VITE_SIGNALING_URL: 'https://connect.ghostpair.dev', VITE_STUN_URLS: ' stun:stun.l.google.com:19302, stuns:stun.ghostpair.dev:5349 ' });
  expect(validateStoreSettings(settings)).toEqual({ signalingUrl: 'https://connect.ghostpair.dev', stunUrls: ['stun:stun.l.google.com:19302', 'stuns:stun.ghostpair.dev:5349'] });
});
