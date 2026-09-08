globalThis.results = {};
chrome.action.onClicked.addListener(async tab => {
  try {
    if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Test authorized tab video capture.' });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    results[tab.id] = await chrome.runtime.sendMessage({ type: 'capture', tabId: tab.id, streamId });
  } catch (error) { results[tab.id] = { error: error.message }; }
});
