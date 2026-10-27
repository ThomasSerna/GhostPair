import assert from 'node:assert/strict';
import { preview } from 'vite';
import { launchHeadlessBrowser } from '../tests/browser/helpers.mjs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const server = await preview({ root: resolve('apps/landing'), preview: { host:'127.0.0.1', port:5196, strictPort:true } });
const browser = await launchHeadlessBrowser();
const output=resolve('tests/browser/.artifacts/site-language');await mkdir(output,{recursive:true});
try {
 for(const width of [1440,390,320]) {
  const context=await browser.newContext({locale:'es-CO',viewport:{width,height:900},reducedMotion:'reduce'});
  for(const view of ['home','installation','explore']) {
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:5196/'+(view==='home'?'':'?view='+view));await page.locator('main:not([aria-busy=true]) h1').first().waitFor();
   assert.equal(await page.locator('html').getAttribute('lang'),'es');
   assert.equal(await page.getByLabel('Idioma',{exact:true}).inputValue(),'auto');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `${view} overflow at ${width}`);
   if(view==='explore') {
    if(width<=700) await page.getByRole('button',{name:'Anfitrión',exact:true}).click();
    await page.getByTestId('interaction-mode').selectOption('full');
    if(width<=700) await page.getByRole('button',{name:'Invitado',exact:true}).click();
    await page.getByTestId('guest-notes').fill('Mi texto < & original');
    await page.getByLabel('Idioma',{exact:true}).selectOption('en');
    assert.equal(await page.getByTestId('guest-notes').inputValue(),'Mi texto < & original');
    assert.equal(await page.getByTestId('interaction-mode').inputValue(),'full');
   } else await page.getByLabel('Idioma',{exact:true}).selectOption('en');
   await page.waitForFunction(()=>document.documentElement.lang==='en');
   await page.reload();await page.getByLabel('Language',{exact:true}).waitFor();assert.equal(await page.getByLabel('Language',{exact:true}).inputValue(),'en');
   await page.getByLabel('Language',{exact:true}).selectOption('auto');await page.waitForFunction(()=>document.documentElement.lang==='es');
   await page.screenshot({path:resolve(output,`${view}-${width}.png`),fullPage:true});
   assert.deepEqual(errors,[]);await page.close();
  }
  await context.close();
 }
 const context=await browser.newContext({locale:'fr-FR'});const a=await context.newPage(),b=await context.newPage();
 await Promise.all([a.goto('http://127.0.0.1:5196/'),b.goto('http://127.0.0.1:5196/?view=installation')]);
 await a.getByLabel('Language',{exact:true}).waitFor();assert.equal(await a.locator('html').getAttribute('lang'),'en');
 await a.getByLabel('Language',{exact:true}).selectOption('es');await b.waitForFunction(()=>document.documentElement.lang==='es');
 await a.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('unavailable');};});await a.getByLabel('Idioma',{exact:true}).selectOption('en');
 await a.getByRole('alert').waitFor();assert.equal(await a.locator('html').getAttribute('lang'),'es');
 await context.close();console.log('Website language: 3 pages × 3 widths, automatic/manual persistence, demo state, cross-tab synchronization and storage failure passed.');
} finally {await browser.close();await new Promise(done=>server.httpServer.close(done));}
