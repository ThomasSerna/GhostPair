// Local test fixture only. No network listener, content scripts, or remote commands.
globalThis.probeFrames = [];
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== 'Page.screencastFrame') return;
  globalThis.probeFrames.push({
    tabId: source.tabId,
    bytes: params.data.length,
    metadata: params.metadata,
    jpeg: params.data.startsWith('/9j/'),
  });
  chrome.debugger.sendCommand(source, 'Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
});
