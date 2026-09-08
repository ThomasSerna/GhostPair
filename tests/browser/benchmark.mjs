import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { createServer } from '../../apps/signaling/dist/server.js';
import { artifactRoot, launchExtension, closeBrowser, removeTestArtifact, poll, resizePage } from './helpers.mjs';
import { startStun } from './stun.mjs';

// Synthetic loopback comparison. Instrumentation is added only to disposable copies.
// Never changes the main checkout or ships the benchmark listener in a package.
const baseline = '3ff895e';
await mkdir(artifactRoot, { recursive: true });
const scratch = await mkdtemp(resolve(artifactRoot, 'benchmark-'));
const archive = resolve(scratch, 'source.tar');
execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, baseline]);
execFileSync('tar', ['-xf', archive, '-C', scratch]);
const root = resolve(scratch, 'apps/extension');
await build({ configFile: false, root, plugins: [react()], base: './', logLevel: 'error',
  resolve: { alias: [
    { find: '@ghostpair/protocol/frames', replacement: resolve(scratch, 'packages/protocol/src/frames.ts') },
    { find: '@ghostpair/protocol', replacement: resolve(scratch, 'packages/protocol/src/index.ts') },
  ] },
  build: { target: 'chrome125', outDir: resolve(scratch, 'mvp'), emptyOutDir: true,
    rollupOptions: { input: Object.fromEntries(['popup', 'viewer', 'offscreen'].map(name => [name, resolve(root, `${name}.html`) ]).concat([['background', resolve(root, 'src/background.ts')]])),
      output: { entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js' } } } });
await cp(resolve('dist/extension'), resolve(scratch, 'native'), { recursive: true });
const instrument = `const peers=[]; const Original=globalThis.RTCPeerConnection;
globalThis.RTCPeerConnection=class extends Original { constructor(...args){super(...args);peers.push(this)} };
let painted=0;const draw=CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage=function(...args){painted++;return draw.apply(this,args)};
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||message.target!=='benchmark.stats'||message.context!==location.pathname)return;
 (async()=>{let videoBytes=0,frameMessages=0;for(const peer of peers){if(peer.connectionState==='closed')continue;
 const stats=await peer.getStats();stats.forEach(r=>{if(r.type==='inbound-rtp'&&r.kind==='video')videoBytes+=r.bytesReceived||0;
 if(r.type==='data-channel'&&r.label==='frames'){videoBytes+=r.bytesReceived||0;frameMessages+=r.messagesReceived||0}})}
 return {videoBytes,frameMessages,frames:document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames??painted};})().then(respond);return true;
});`;
for (const variant of ['mvp', 'native']) {
  const path = resolve(scratch, variant);
  const manifest = JSON.parse(await readFile(resolve(path, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://*/*', 'https://*/*'];
  await writeFile(resolve(path, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(resolve(path, 'benchmark-instrument.js'), instrument);
  for (const name of ['viewer', 'offscreen']) {
    const file = resolve(path, `${name}.html`);
    await writeFile(file, (await readFile(file, 'utf8')).replace('<head>', '<head><script src="benchmark-instrument.js"></script>'));
  }
}
const fixture = httpServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html><head><title>GhostPair benchmark</title><style>body{margin:0;background:#f6f0df;font:24px sans-serif}h1{margin:32px}canvas{display:block;width:100%;height:560px}</style></head><body><h1>GhostPair synthetic animation, 30 updates per second</h1><canvas width="1280" height="560"></canvas><script>const c=document.querySelector('canvas').getContext('2d');let f=0;setInterval(()=>{c.fillStyle='#f6f0df';c.fillRect(0,0,1280,560);for(let i=0;i<40;i++){c.fillStyle=['#153b40','#df795b','#d8ac49','#5d918b'][i%4];c.fillRect((f*4+i*71)%1280,(i*59)%500,50,50)}c.fillStyle='#123638';c.fillText(String(++f),40,40)},1000/30)</script></body></html>`);
});
await new Promise(done => fixture.listen(0, '127.0.0.1', done));
const stun = await startStun(), results = [];
async function call(page, type, fields = {}) {
  const reply = await page.evaluate(({type,fields}) => chrome.runtime.sendMessage({target:'background',type,...fields}), {type,fields});
  if (!reply?.ok) throw new Error(`${type}: ${reply?.error}`); return reply.state;
}
async function cpu(browser) { return new Map((await browser.cdp.send('SystemInfo.getProcessInfo')).processInfo.map(p => [p.id, p.cpuTime])); }
function cpuDelta(before, after) { let total=0; for(const [id,time] of after) if(before.has(id)) total+=Math.max(0,time-before.get(id)); return total; }
async function stats(page, context) { return page.evaluate(context => chrome.runtime.sendMessage({target:'benchmark.stats',context}), context); }
try {
  for (const variant of ['mvp', 'native']) {
    let host, guest, server;
    try {
      host = await launchExtension('chrome', resolve(scratch, variant)); guest = await launchExtension('chrome', resolve(scratch, variant));
      server = createServer({ databasePath: ':memory:', port: 0, allowedOrigins: [`chrome-extension://${host.id}`, `chrome-extension://${guest.id}`] });
      const address = await server.listen(0), settings = { signalingUrl: `http://127.0.0.1:${address.port}`, stunUrls: [stun.url] };
      const hostUi = await host.context.newPage(); await hostUi.goto(`chrome-extension://${host.id}/popup.html`);
      const guestUi = await guest.context.newPage(); await guestUi.goto(`chrome-extension://${guest.id}/${variant === 'mvp' ? 'popup' : 'viewer'}.html`);
      await call(hostUi, 'ui.settings.save', {settings}); await call(guestUi, 'ui.settings.save', {settings});
      const page = await host.context.newPage(); await page.goto(`http://127.0.0.1:${fixture.address().port}`); await resizePage(host, page, 1280, 720);
      await page.bringToFront();
      if(variant === 'native') {
        const {targetInfos}=await host.cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
        await host.cdp.send('Extensions.triggerAction',{id:host.id,targetId:targetInfos.find(t=>t.url===page.url()).targetId});
      }
      await call(hostUi,'ui.host.start',{password:'Synthetic-session-42',clipboard:false});
      const waiting=await poll(async()=>{const s=await call(hostUi,'ui.status');return s.status==='waiting'?s:false},'benchmark host waiting');
      await call(guestUi,'ui.guest.start',{deviceId:waiting.deviceId,password:'Synthetic-session-42',clipboard:false});
      await poll(async()=>(await call(guestUi,'ui.status')).status==='connected','benchmark direct connection',30000);
      const viewer=await poll(()=>guest.context.pages().find(p=>p.url()===`chrome-extension://${guest.id}/viewer.html`),'benchmark viewer');
      await poll(()=>viewer.locator(variant==='mvp'?'canvas':'video').evaluate(e=>e.tagName==='VIDEO'?e.readyState>=2:e.width>300&&!e.classList.contains('invisible')),'benchmark image');
      await new Promise(done=>setTimeout(done,3000));
      const context=variant==='mvp'?'/offscreen.html':'/viewer.html';
      const [before,frameBefore,hostCpu,guestCpu]=await Promise.all([stats(guest.worker,context),stats(guest.worker,'/viewer.html'),cpu(host),cpu(guest)]);
      const start=performance.now(); await new Promise(done=>setTimeout(done,5000));
      const [after,frameAfter,hostCpuAfter,guestCpuAfter]=await Promise.all([stats(guest.worker,context),stats(guest.worker,'/viewer.html'),cpu(host),cpu(guest)]);
      const seconds=(performance.now()-start)/1000;
      assert.ok(after.videoBytes>before.videoBytes,'video byte counter must increase');
      results.push({variant,baseline:variant==='mvp'?baseline:undefined,browser:host.version,viewport:'1280x720',seconds,
        videoPayloadBytes:after.videoBytes-before.videoBytes,megabitsPerSecond:(after.videoBytes-before.videoBytes)*8/seconds/1e6,
        renderedFrames:frameAfter.frames-frameBefore.frames,framesPerSecond:(frameAfter.frames-frameBefore.frames)/seconds,
        combinedBrowserCpuSeconds:cpuDelta(hostCpu,hostCpuAfter)+cpuDelta(guestCpu,guestCpuAfter)});
      console.log(JSON.stringify(results.at(-1)));
    } finally { await closeBrowser(guest);await closeBrowser(host);await server?.close(); }
  }
  await writeFile(resolve(artifactRoot,'benchmark-results.json'),JSON.stringify({at:new Date().toISOString(),workload:'30 Hz moving rectangles; 3 s warmup; 5 s sample; Chrome loopback; clipboard disabled; current locked dependencies',results},null,2));
} finally { await stun.close();await new Promise(done=>fixture.close(done));await removeTestArtifact(scratch); }
