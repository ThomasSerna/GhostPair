import { describe, expect, it } from 'vitest';
import { GHOSTPAIR_SERVER_SETTINGS, getConnectionServerMode, parseCustomConnectionSettings } from './connection-presets';

describe('connection server selection', () => {
  it('recognizes the official preset without treating local or modified settings as official', () => {
    expect(getConnectionServerMode(GHOSTPAIR_SERVER_SETTINGS)).toBe('ghostpair');
    expect(getConnectionServerMode({ ...GHOSTPAIR_SERVER_SETTINGS, signalingUrl: `${GHOSTPAIR_SERVER_SETTINGS.signalingUrl}/` })).toBe('ghostpair');
    expect(getConnectionServerMode({ ...GHOSTPAIR_SERVER_SETTINGS, signalingUrl: 'http://127.0.0.1:8787' })).toBe('custom');
    expect(getConnectionServerMode({ ...GHOSTPAIR_SERVER_SETTINGS, stunUrls: ['stun:another.example.com:3478'] })).toBe('custom');
    expect(getConnectionServerMode({ ...GHOSTPAIR_SERVER_SETTINGS, stunUrls: [...GHOSTPAIR_SERVER_SETTINGS.stunUrls, 'stuns:another.example.com:5349'] })).toBe('custom');
  });

  it('keeps existing custom normalization and loopback support', () => {
    expect(parseCustomConnectionSettings(' https://connect.example.com/ ', ' stun:first.example.com:3478,\n stuns:second.example.com:5349\n ')).toEqual({
      signalingUrl: 'https://connect.example.com', stunUrls: ['stun:first.example.com:3478', 'stuns:second.example.com:5349'],
    });
    expect(parseCustomConnectionSettings('http://localhost:8787', 'stun:local.example.com:3478').signalingUrl).toBe('http://localhost:8787');
  });

  it('preserves secure connection URL validation', () => {
    for (const url of ['invalid', 'http://connect.example.com', 'https://name:secret@connect.example.com', 'https://connect.example.com?secret=value', 'https://connect.example.com#secret']) {
      expect(() => parseCustomConnectionSettings(url, 'stun:first.example.com:3478')).toThrow();
    }
  });

  it('preserves STUN-only validation and the one-to-five limit', () => {
    for (const stun of ['', 'turn:relay.example.com:3478', 'stun:has space', Array.from({ length: 6 }, (_, index) => `stun:server${index}.example.com:3478`).join(',')]) {
      expect(() => parseCustomConnectionSettings('https://connect.example.com', stun)).toThrow();
    }
  });
});
