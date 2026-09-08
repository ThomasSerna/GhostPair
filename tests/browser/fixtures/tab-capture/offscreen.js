const sources = new Map();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'capture') return;
  navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } } }).then(async stream => {
    sources.set(message.tabId, stream);
    const video = document.createElement('video'); video.muted = true; video.srcObject = stream; document.body.append(video); await video.play();
    respond({ state: stream.getVideoTracks()[0].readyState, width: video.videoWidth, height: video.videoHeight });
  }).catch(error => respond({ error: error.message }));
  return true;
});
