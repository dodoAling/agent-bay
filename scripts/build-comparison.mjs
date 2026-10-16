import { copyFile, writeFile } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';

const [source, reconstructed = 'artifacts/promo-factory-v3-final-square-24.8s.mp4'] = process.argv.slice(2);
if (!source) throw new Error('Usage: node scripts/build-comparison.mjs path/to/reference.mp4 [path/to/reconstruction.mp4]');
const directory = resolve('artifacts');
await copyFile(resolve(source), join(directory, 'reference-source.mp4'));
const output = join(directory, 'reference-comparison.html');
const videoName = basename(reconstructed);
if (!/^[a-zA-Z0-9_.-]+\.mp4$/.test(videoName)) throw new Error('Use a plain MP4 filename for the reconstruction.');
await writeFile(output, `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Frame comparison · Agent Bay</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0c1119;color:#d4dce8;font:14px/1.6 system-ui,sans-serif;padding:20px}h1{font-size:21px;margin:0 0 5px}p{color:#8999ae;margin:0 0 16px}main{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:2160px;margin:auto}figure{margin:0;min-width:0}figcaption{color:#a7c6e4;margin-bottom:6px}video{display:block;width:100%;aspect-ratio:1;background:#080e17;border-radius:9px}.controls{position:sticky;bottom:0;background:#101b2bf5;padding:15px;border:1px solid #293b55;border-radius:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:16px}button{background:#15263c;color:#8ed3ff;border:1px solid #365b80;border-radius:5px;padding:6px 12px;cursor:pointer}input{flex:1;min-width:200px;accent-color:#39b9ff}output{font:13px monospace;color:#95c9ed;min-width:190px}.error{color:#ff7186}footer{font-size:12px;color:#8191a7;margin-top:12px}@media(max-width:760px){main{grid-template-columns:1fr}body{padding:10px}}
</style>
<h1>Video and native interface · synchronized frame comparison</h1><p>1080 × 1080 · 30 fps · 744 frames. Use the arrow keys or buttons to step through frames, or drag the slider to compare a timestamp. The right side is a simulated Canvas/DOM preview.</p>
<main><figure><figcaption>Source video · comparison only</figcaption><video id="source" src="reference-source.mp4" preload="auto" muted playsinline></video></figure><figure><figcaption>Agent Bay · native rendering · DEMO</figcaption><video id="rebuilt" src="${videoName}" preload="auto" muted playsinline></video></figure></main>
<div class="controls"><button id="play">Play</button><button id="previous">← Previous frame</button><button id="next">Next frame →</button><input id="position" type="range" min="0" max="743" value="0" aria-label="Frame position"><output id="time">Frame 1 / 744 · 0.000 s</output></div>
<footer>Agent Bay branding and DEMO labels remain visible. Fonts, pixel characters and simulated logs can differ. Preset data on the right is not an actual analysis result.<span id="error" class="error"></span></footer>
<script>
const a=document.querySelector('#source'), b=document.querySelector('#rebuilt'), range=document.querySelector('#position'), time=document.querySelector('#time'), play=document.querySelector('#play');
let playing=false, pending=0;
function label(frame){range.value=frame;time.textContent='Frame '+(frame+1)+' / 744 · '+(frame/30).toFixed(3)+' s';}
function pause(){playing=false;a.pause();b.pause();play.textContent='Play';}
function seek(frame){pause();frame=Math.max(0,Math.min(743,Math.round(frame)));label(frame);a.currentTime=frame/30+0.00001;b.currentTime=frame/30+0.00001;}
range.oninput=()=>seek(Number(range.value));
document.querySelector('#previous').onclick=()=>seek(Number(range.value)-1);
document.querySelector('#next').onclick=()=>seek(Number(range.value)+1);
play.onclick=async()=>{if(playing){pause();return;}if(a.currentTime>=24.76){seek(0);}try{b.currentTime=a.currentTime;await Promise.all([a.play(),b.play()]);playing=true;play.textContent='Pause';}catch(e){pause();document.querySelector('#error').textContent=' Playback failed:'+e.message;}};
function tick(){if(playing){const frame=Math.min(743,Math.floor(a.currentTime*30));label(frame);if(Math.abs(a.currentTime-b.currentTime)>.035)b.currentTime=a.currentTime;if(a.currentTime>=24.766){pause();seek(743);}}requestAnimationFrame(tick);}tick();
document.onkeydown=e=>{if(e.target.matches('input'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();seek(Number(range.value)+(e.key==='ArrowRight'?1:-1));}if(e.code==='Space'){e.preventDefault();play.click();}};
for(const v of[a,b])v.onerror=()=>{document.querySelector('#error').textContent=' Keep this page and both MP4 files in the same directory.';};
</script></html>`);
console.log(output);
