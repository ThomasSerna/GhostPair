import { isIP } from 'node:net';

export function buildSettings(env) {
  return {
    signalingUrl: env.VITE_SIGNALING_URL || 'http://127.0.0.1:8787',
    stunUrls: (env.VITE_STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean),
  };
}
function publicDomain(host) {
  return !isIP(host) && !host.includes(':') && host.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host) &&
    host.split('.').every(label => label.length <= 63) &&
    !/(^|\.)(localhost|local|test|invalid|example|internal|lan|home|onion)$|(^|\.)(example\.(com|org|net)|home\.arpa)$|(^|\.)(your-domain|yourdomain|replace-me)(\.|$)/i.test(host);
}
export function validateStoreSettings(settings) {
  let url;
  try { url = new URL(settings.signalingUrl); } catch { throw new Error('Store builds require a public HTTPS signaling URL.'); }
  if (url.protocol !== 'https:' || !publicDomain(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port && url.port !== '443') throw new Error('Store builds require a public HTTPS signaling origin without credentials, paths or placeholders.');
  if (!Array.isArray(settings.stunUrls) || settings.stunUrls.length < 1 || settings.stunUrls.length > 5) throw new Error('Configure one to five public STUN endpoints.');
  for (const endpoint of settings.stunUrls) {
    const match = /^stuns?:([^:/?\s]+)(?::([0-9]+))?$/i.exec(endpoint);
    if (!match || !publicDomain(match[1]) || match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535)) throw new Error('Store builds require public STUN domain names and valid ports.');
  }
  return settings;
}
