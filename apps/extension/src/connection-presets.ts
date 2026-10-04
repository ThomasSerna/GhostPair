import { SettingsSchema, type Settings } from '@ghostpair/protocol';

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
    const urlIssue = parsed.error.issues.find(issue => issue.path[0] === 'signalingUrl');
    if (urlIssue) throw new Error(urlIssue.code === 'custom' ? urlIssue.message : 'Enter a valid connection server URL.');
    throw new Error('Add one to five STUN servers, each starting with stun: or stuns:.');
  }
  return parsed.data;
}
