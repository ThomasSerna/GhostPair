import { SettingsSchema, validateSignalingUrl, type Settings } from '@ghostpair/protocol';

export const GHOSTPAIR_SERVER_SETTINGS: Settings = {
  signalingUrl: 'https://ghostpair.onrender.com',
  stunUrls: ['stun:stun.l.google.com:19302'],
};

export function getConnectionServerMode(settings: Settings): 'ghostpair' | 'custom' {
  return settings.signalingUrl.replace(/\/$/, '') === GHOSTPAIR_SERVER_SETTINGS.signalingUrl &&
    settings.stunUrls.length === GHOSTPAIR_SERVER_SETTINGS.stunUrls.length &&
    settings.stunUrls.every((url, index) => url === GHOSTPAIR_SERVER_SETTINGS.stunUrls[index]) ? 'ghostpair' : 'custom';
}

export function parseCustomConnectionSettings(url: string, stun: string): Settings {
  const signalingUrl = url.trim().replace(/\/$/, '');
  const parsed = SettingsSchema.safeParse({ signalingUrl, stunUrls: stun.split(/[\n,]/).map(value => value.trim()).filter(Boolean) });
  if (!parsed.success) {
    if (parsed.error.issues.some(issue => issue.path[0] === 'signalingUrl')) throw new Error('Enter a valid connection server URL.');
    throw new Error('Add one to five STUN servers, each starting with stun: or stuns:.');
  }
  if (!validateSignalingUrl(parsed.data.signalingUrl)) throw new Error('Use HTTPS for the connection server, or HTTP on localhost. Remove credentials and query parameters from the URL.');
  return parsed.data;
}
