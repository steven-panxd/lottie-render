const el = id => document.getElementById(id);
let selected, config, controller, videoUrl, animationData;
let previewReady = false, playing = false, converting = false, selecting = false;
let selectionVersion = 0, duration = 0;
const send = (type, values = {}) => el('animation').contentWindow.postMessage({ source: 'lottie-demo', type, ...values }, '*');
function message(text, error = false) {
  el('status').textContent = text;
  el('status').dataset.error = String(error);
}
function controls() {
  const unavailable = !config || converting || selecting;
  for (const id of ['render', 'sample', 'file']) el(id).disabled = unavailable;
  el('cancel').hidden = !converting;
  el('rendering').hidden = !converting;
  el('preview').setAttribute('aria-busy', String(converting));
}
function setPlaying(on) {
  playing = on;
  el('play').setAttribute('aria-label', on ? 'Pause animation' : 'Play animation');
  el('play-icon').hidden = on;
  el('pause-icon').hidden = !on;
}
function progress(value) {
  el('seek').value = Math.max(0, Math.min(1, value));
  el('time').textContent = `${(value * duration).toFixed(1)} / ${duration.toFixed(1)}s`;
}
function clearVideo() {
  el('video').pause();
  el('video').hidden = true;
  el('video').removeAttribute('src');
  el('video').load();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = undefined;
  el('download').hidden = true;
  el('star-prompt').hidden = true;
  el('download').removeAttribute('href');
  el('render').hidden = false;
  el('animation').hidden = false;
  el('preview-type').textContent = 'Lottie preview';
}
async function select(file, sample = false) {
  if (!config || converting) return;
  const version = ++selectionVersion;
  selecting = true;
  controls();
  try {
    if (file.size > config.maxUploadBytes) throw Error(`Choose a file smaller than ${(config.maxUploadBytes / 1048576).toFixed(0)} MiB.`);
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw Error('This file is not valid JSON. Choose a Lottie JSON export.'); }
    if (version !== selectionVersion) return;
    if (!data || !Array.isArray(data.layers) || ![data.w, data.h, data.fr, data.op].every(n => Number.isFinite(n) && n > 0) || !Number.isFinite(data.ip) || data.op <= data.ip) throw Error('This JSON is not a valid Lottie animation.');
    const seconds = (data.op - data.ip) / data.fr;
    if (seconds > config.maxDuration) throw Error(`Choose an animation no longer than ${config.maxDuration} seconds.`);
    selected = file;
    animationData = data;
    duration = seconds;
    clearVideo();
    setPlaying(false);
    el('play').disabled = true;
    el('seek').disabled = true;
    el('filename').textContent = file.name;
    el('filename').title = file.name;
    const scale = Math.min(1, config.maxDimension / Math.max(data.w, data.h));
    el('dimensions').textContent = `${Math.max(2, Math.floor(data.w * scale / 2) * 2)} × ${Math.max(2, Math.floor(data.h * scale / 2) * 2)}`;
    el('fps').textContent = `${Math.min(data.fr, 30)} FPS`;
    fitArtboard(data.w, data.h);
    progress(0);
    if (previewReady) send('load', { data });
    message(sample ? 'Sample loaded. Convert it to try the full workflow.' : 'Ready to convert. Your file has not been uploaded.');
  } catch (error) {
    if (version === selectionVersion) message(error.message, true);
  } finally {
    if (version === selectionVersion) { selecting = false; controls(); }
  }
}
function fitArtboard(width, height) {
  const ratio = width / height;
  el('artboard').style.aspectRatio = `${width} / ${height}`;
  el('artboard').style.width = `min(100%, ${Math.min(350, 350 * ratio)}px)`;
}
async function loadSample() {
  if (converting || selecting) return;
  selecting = true;
  controls();
  try {
    const response = await fetch('/sample.json');
    if (!response.ok) throw Error('The sample could not load. Choose your own JSON file.');
    await select(new File([await response.blob()], 'sample.json', { type: 'application/json' }), true);
  } catch (error) { message(error.message, true); }
  finally { selecting = false; controls(); }
}
window.addEventListener('message', event => {
  if (event.source !== el('animation').contentWindow || event.data?.source !== 'lottie-preview') return;
  const { type } = event.data;
  if (type === 'ready') { previewReady = true; if (animationData) send('load', { data: animationData }); }
  if (videoUrl) return;
  if (type === 'loaded') { el('play').disabled = false; el('seek').disabled = false; }
  if (type === 'frame') progress(event.data.progress);
  if (type === 'paused') setPlaying(false);
  if (type === 'error') message('Local preview unavailable for this animation. You can still try converting it.', true);
});
el('play').onclick = () => {
  if (videoUrl) {
    if (playing) el('video').pause();
    else el('video').play().catch(() => message('Video playback failed. Download the MP4 to open it locally.', true));
  } else { send(playing ? 'pause' : 'play'); setPlaying(!playing); }
};
el('seek').oninput = event => {
  const value = Number(event.target.value);
  setPlaying(false);
  if (videoUrl) { el('video').pause(); el('video').currentTime = value * el('video').duration; }
  else send('seek', { progress: value });
  progress(value);
};
el('video').addEventListener('play', () => setPlaying(true));
el('video').addEventListener('pause', () => setPlaying(false));
el('video').addEventListener('timeupdate', () => { if (videoUrl && el('video').duration) progress(el('video').currentTime / el('video').duration); });
el('video').addEventListener('loadedmetadata', () => { duration = el('video').duration; progress(0); el('play').disabled = false; el('seek').disabled = false; });
el('file').onchange = event => { const file = event.target.files[0]; if (file) select(file); event.target.value = ''; };
el('sample').onclick = loadSample;
el('cancel').onclick = () => controller?.abort();
el('form').onsubmit = event => { event.preventDefault(); convert(); };
let dragDepth = 0;
el('workspace').addEventListener('dragenter', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault(); dragDepth++;
  if (!converting) el('drop-overlay').hidden = false;
});
el('workspace').addEventListener('dragover', event => event.preventDefault());
el('workspace').addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el('drop-overlay').hidden = true; } });
el('workspace').addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; el('drop-overlay').hidden = true;
  const file = event.dataTransfer.files[0];
  if (file && !converting && !selecting) select(file);
});
async function convert() {
  if (!config || converting || selecting) return;
  if (!selected) { message('Choose a JSON file first.', true); return; }
  converting = true;
  controller = new AbortController();
  controls();
  message('Rendering on the server. You can cancel at any time.');
  send('pause');
  setPlaying(false);
  try {
    const data = new FormData(); data.append('file', selected);
    const headers = {};
    if (el('key').value) headers['X-API-Key'] = el('key').value;
    const response = await fetch('/api/render', { method: 'POST', body: data, headers, signal: controller.signal });
    if (!response.ok) {
      let detail;
      try { detail = await response.json(); } catch {}
      throw Error(detail?.error || `Conversion failed (${response.status}). Please try again.`);
    }
    videoUrl = URL.createObjectURL(await response.blob());
    send('pause');
    setPlaying(false);
    el('play').disabled = true;
    el('seek').disabled = true;
    el('video').src = videoUrl;
    el('video').hidden = false;
    el('animation').hidden = true;
    el('preview-type').textContent = 'MP4 preview';
    el('download').href = videoUrl;
    el('download').download = selected.name.replace(/\.json$/i, '') + '.mp4';
    el('download').hidden = false;
    el('star-prompt').hidden = false;
    el('render').hidden = true;
    const width = response.headers.get('X-Video-Width'), height = response.headers.get('X-Video-Height');
    el('dimensions').textContent = `${width} × ${height}`;
    el('fps').textContent = `${response.headers.get('X-Video-FPS')} FPS`;
    fitArtboard(Number(width), Number(height));
    const seconds = Number(response.headers.get('X-Render-Duration')) / 1000;
    message(`Done in ${seconds.toFixed(1)}s. Your MP4 is ready.`);
  } catch (error) {
    message(error.name === 'AbortError' ? 'Conversion cancelled. You can try again.' : error.message, error.name !== 'AbortError');
  } finally { controller = undefined; converting = false; controls(); }
}
fetch('/api/config').then(response => {
  if (!response.ok) throw Error('The demo could not load. Please reload the page.');
  return response.json();
}).then(async data => {
  config = data;
  el('limits').textContent = `Free demo: ${(data.maxUploadBytes / 1048576).toFixed(0)} MiB per file, ${data.maxDuration}s max. Output up to ${data.maxDimension}px at 30 FPS.`;
  el('key-label').hidden = !data.requiresApiKey;
  controls();
  await loadSample();
}).catch(error => message(error.message, true));
