/* Opt-in production smoke/E2E test. Requires Chromium and ffprobe.
 * node scripts/test-live-demo.cjs https://your-demo.example /absolute/report-directory
 * Makes real render requests, including a deliberate rate-limit check. */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) throw new Error('Supply an explicit demo URL');
const origin = new URL(base).origin;
const out = path.resolve(process.argv[3] || 'work/live-e2e');
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function check(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log('PASS', name); }
async function health() { return (await fetch(origin + '/api/health')).json(); }
async function idle() { for (let i=0;i<120;i++) { if ((await health()).activeRenders === 0) return; await sleep(500); } throw Error('Renderer did not become idle'); }
function upload(bytes, name='test.json') { const form = new FormData(); form.set('file', new Blob([bytes], {type:'application/json'}), name); return form; }
(async () => {
 await fs.mkdir(out, {recursive:true});
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage({viewport:{width:1280,height:900}, acceptDownloads:true});
  page.setDefaultTimeout(75000);
  const errors=[]; let posts=0;
  page.on('pageerror', e=>errors.push(e.message));
  page.on('request', r=>{if(r.method()==='POST' && r.url().endsWith('/api/render')) posts++;});
  const sample = await (await fetch(origin+'/sample.json')).json();
  const fixture = {...sample,w:1024,h:512,fr:60,ip:0,op:120};
  await check('HTTPS, health and public discovery', async()=>{
   assert.equal((await health()).status,'ok');
   const response=await page.goto(origin); assert.equal(response.status(),200);
   assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), origin+'/');
   for(const file of ['/robots.txt','/sitemap.xml','/llms.txt']) assert.equal((await fetch(origin+file)).status,200);
   assert.match((await fetch(origin+'/preview.html')).headers.get('x-robots-tag'),/noindex/);
  });
  await check('Local sample preview plays without rendering',async()=>{
   await page.waitForFunction(()=>!document.querySelector('#play').disabled);
   await page.locator('#play').click();
   await page.waitForFunction(()=>Number(document.querySelector('#seek').value)>.1);
   await page.locator('#play').click(); assert.equal(posts,0);
  });
  const select = (name, buffer)=>page.locator('#file').setInputFiles({name,mimeType:'application/json',buffer});
  await check('Client rejects invalid JSON, oversized files and long animations',async()=>{
   for(const [name,buffer,pattern] of [
    ['broken.json',Buffer.from('{'),/not valid JSON/],
    ['large.json',Buffer.alloc(2097153,32),/smaller|MiB|size/i],
    ['long.json',Buffer.from(JSON.stringify({...sample,fr:30,ip:0,op:330})),/10|long|duration/i]
   ]) { await select(name,buffer); await page.waitForFunction(()=>document.querySelector('#status').dataset.error==='true'); assert.match(await page.locator('#status').textContent(),pattern); }
   assert.equal(posts,0);
  });
  await check('Upload, convert, video playback, seek and actual MP4 download',async()=>{
   await select('my animation.json',Buffer.from(JSON.stringify(fixture)));
   await page.locator('#render').click(); await page.locator('#download').waitFor({state:'visible'});
   await page.waitForFunction(()=>document.querySelector('#video').readyState>=2);
   await page.locator('#play').click();
   await page.waitForFunction(()=>document.querySelector('#video').currentTime>.1);
   await page.locator('#play').click();
   await page.locator('#seek').focus(); await page.keyboard.press('End');
   await page.waitForFunction(()=>document.querySelector('#video').currentTime>1);
   const promise=page.waitForEvent('download'); await page.locator('#download').click(); const download=await promise;
   assert.equal(download.suggestedFilename(),'my animation.mp4');
   const file=path.join(out,'live-output.mp4'); await download.saveAs(file);
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
   const v=probe.streams.find(s=>s.codec_type==='video');
   assert.equal(v.codec_name,'h264'); assert.equal(v.width,512); assert.equal(v.height,256); assert.equal(v.r_frame_rate,'30/1'); assert.equal(Number(v.nb_frames),60); assert.ok(Math.abs(Number(probe.format.duration)-2)<.1);
   await fs.writeFile(path.join(out,'video-metadata.json'),JSON.stringify(probe,null,2));
   await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
  });
  await check('Mobile layouts at 360, 390 and 768 pixels',async()=>{
   for(const width of [360,390,768]) {await page.setViewportSize({width,height:844}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); assert.ok(await page.locator('#download').isVisible());}
   await page.setViewportSize({width:390,height:844}); await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  });
  await check('Reset sample and cancel a real render, releasing capacity',async()=>{
   await page.locator('#sample').click(); await page.waitForFunction(()=>!document.querySelector('#render').disabled);
   assert.ok(await page.locator('#download').isHidden());
   await page.locator('#render').click();
   for(let i=0;i<30 && (await health()).activeRenders!==1;i++) await sleep(100);
   assert.equal((await health()).activeRenders,1);
   await page.locator('#cancel').click();
   await page.waitForFunction(()=>/cancel/i.test(document.querySelector('#status').textContent)); await idle();
  });
  await check('Concurrent render rejected with 503 and UI recovers',async()=>{
   const pending=fetch(origin+'/api/render',{method:'POST',body:upload(JSON.stringify({...sample,ip:0,op:300,fr:30}))});
   for(let i=0;i<40 && (await health()).activeRenders!==1;i++) await sleep(100);
   assert.equal((await health()).activeRenders,1);
   const event=page.waitForResponse(r=>r.url().endsWith('/api/render')); await page.locator('#render').click(); const response=await event;
   assert.equal(response.status(),503); assert.equal(response.headers()['retry-after'],'5');
   await page.waitForFunction(()=>document.querySelector('#status').dataset.error==='true');
   assert.equal(await page.locator('#render').isEnabled(),true);
   const result=await pending; assert.equal(result.status,200); await result.arrayBuffer(); await idle();
  });
  await check('Server rejects oversized and malformed uploads',async()=>{
   for(const [bytes,status] of [[Buffer.alloc(2097153,32),413],['{',400]]) {
    const response=await fetch(origin+'/api/render',{method:'POST',body:upload(bytes)}); assert.equal(response.status,status); await response.text(); await idle();
   }
  });
  await check('Rate limit returns 429, then a real browser retry succeeds',async()=>{
   const event=page.waitForResponse(r=>r.url().endsWith('/api/render')); await page.locator('#render').click(); const response=await event;
   assert.equal(response.status(),429); const retry=Number(response.headers()['retry-after']); assert.ok(retry>0 && retry<=60);
   await page.waitForFunction(()=>document.querySelector('#status').dataset.error==='true');
   console.log('Waiting for rate window:',retry,'seconds'); await sleep((retry+1)*1000);
   await page.locator('#render').click(); await page.locator('#download').waitFor({state:'visible'}); await idle();
  });
  await check('No uncaught browser errors',async()=>assert.deepEqual(errors,[]));
 } catch(error) { results.push({status:'failed',error:error.stack}); process.exitCode=1; console.error(error); }
 finally {await browser.close(); await fs.writeFile(path.join(out,'report.json'),JSON.stringify({url:origin,time:new Date().toISOString(),results},null,2));}
})();
