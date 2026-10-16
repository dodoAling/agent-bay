const C = { bg: '#09131d', line: '#253043', dim: '#637086', text: '#d5dce7', blue: '#299dff', cyan: '#48ceef', red: '#f04461', white: '#cbd9ef' };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class FactoryView {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.data = { calls: [], events: [], checks: [], running: false, elapsed: 0, demo: false, total: 0 };
    this.width = 700; this.height = 390;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.addEventListener('change', () => this.draw());
    this.observer = new ResizeObserver(() => { this.resize(); this.draw(); });
    this.observer.observe(canvas);
    const tick = () => {
      const animated = this.data.demo ? this.data.running : ['working', 'waiting'].includes(liveVisualState(this.data));
      if (!document.hidden && animated && !this.data.paused && !this.reducedMotion.matches) this.draw();
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height); this.dpr = dpr;
    const width = Math.round(this.width * dpr), height = Math.round(this.height * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
  }
  update(data) { this.data = data; this.resize(); this.draw(); }
  time() { return this.data.demo ? this.data.elapsed / 1000 : (performance.now() - (this.data.clockStart || 0)) / 1000; }
  draw(forcedMs) {
    if (this.data.reference) { this.stats = this.data.desktopPreview || this.width / this.height > 2.25 ? drawWideDemoFactory(this, forcedMs) : drawReferenceFactory(this, forcedMs); return; }
    if (!this.data.demo) { this.stats = drawLiveFactory(this, forcedMs); return; }
    if (this.data.desktopPreview || this.width / this.height > 2.25) { this.stats = drawWideDemoFactory(this, forcedMs); return; }
    const ctx = this.ctx, d = this.data, calls = d.calls || [], completed = calls.filter(c => !c.pending), successful = completed.filter(c => c.end?.ok), failed = completed.filter(c => c.end?.ok === false);
    const successfulCount = d.summary?.success ?? successful.length, failedCount = d.summary?.errors ?? failed.length;
    const completedCount = d.summary ? d.summary.calls - d.summary.pending : completed.length;
    const time = forcedMs === undefined ? this.time() : forcedMs / 1000;
    const motion = d.running ? time : (d.elapsed || 0) / 1000;
    const pulse = .5 + .5 * Math.sin(motion * 5);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const scale = Math.min((this.width - 24) / 700, (this.height - 24) / 390), dpr = this.dpr || 1;
    const sceneX = (this.width - 700 * scale) / 2, sceneY = (this.height - 390 * scale) / 2;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, sceneX * dpr, sceneY * dpr);
    const text = (str, x, y, color = C.dim, size = 11, bold = false, align = 'left') => { ctx.fillStyle = color; ctx.font = `${bold ? '600 ' : ''}${size}px Consolas, monospace`; ctx.textAlign = align; ctx.fillText(String(str), x, y); ctx.textAlign = 'left'; };
    const rect = (x, y, w, h, fill, stroke, radius = 5, width = 1.5) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); } };
    const line = (x1, y1, x2, y2, color, width = 1) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); };
    const isActive = !!d.running && (calls.length > 0 || (d.summary?.calls || 0) > 0);
    const phase = Math.min(11, Math.floor((d.progress || 0) * 12));
    text('01 READ', 118, 24, C.text, 12, true, 'center');
    text('02 CONTEXT', 301, 24, C.text, 12, true, 'center');
    text('03 BUILD', 470, 24, C.text, 12, true, 'center');
    text('04 CHECK', 574, 24, C.text, 12, true, 'center');

    // A small input binary, a live reader and its moving scan head.
    ctx.beginPath(); ctx.moveTo(16, 73); ctx.lineTo(34, 73); ctx.lineTo(42, 81); ctx.lineTo(42, 110); ctx.lineTo(16, 110); ctx.closePath(); ctx.fillStyle = '#102035'; ctx.fill(); ctx.strokeStyle = '#3788c8'; ctx.stroke();
    text('01', 29, 91, '#82c7ff', 8, true, 'center'); text('10', 29, 102, '#82c7ff', 8, true, 'center'); text(d.demo ? 'binary' : 'input', 29, 124, C.dim, 9, false, 'center');
    const readerColor = isActive ? C.blue : '#336596';
    if (isActive) { ctx.shadowBlur = 10 + pulse * 7; ctx.shadowColor = '#209cff44'; }
    rect(65, 49, 120, 101, '#0c1725', readerColor, 6, 2); ctx.shadowBlur = 0;
    text(d.sourceLabel || 'REA', 73, 67, C.blue, 15, true);
    ctx.beginPath(); ctx.arc(173, 61, 3, 0, Math.PI * 2); ctx.fillStyle = isActive ? C.cyan : '#28374d'; ctx.fill();
    line(71, 77, 178, 77, '#237ab5');
    ctx.save(); ctx.beginPath(); ctx.rect(72, 80, 107, 64); ctx.clip();
    const source = Array.isArray(d.readerLines) && d.readerLines.length ? d.readerLines.map(String) : ['waiting for tool data', 'no target loaded'];
    const offset = isActive ? (motion * 12) % 11 : 0;
    for (let i = -1; i < 8; i++) text(source[((Math.floor(motion * .7) + i) % source.length + source.length) % source.length].slice(0, 24), 74, 88 + i * 11 - offset, '#71829d', 8);
    ctx.restore();
    const scanY = 82 + (motion * 24) % 59;
    if (isActive) { ctx.shadowBlur = 8; ctx.shadowColor = C.blue; line(71, scanY, 179, scanY, '#69c7ff', 2); ctx.shadowBlur = 0; }

    // Context boundary: two bright rails and a narrow shimmer, not a security claim.
    const beam = ctx.createLinearGradient(296, 0, 310, 0); beam.addColorStop(0, '#49cfff00'); beam.addColorStop(.45, '#49cfff44'); beam.addColorStop(.6, '#57d8ff'); beam.addColorStop(1, '#49cfff00');
    ctx.fillStyle = beam; ctx.fillRect(296, 38, 14, 347);
    line(302, 39, 302, 384, '#49cfff', 2);
    ctx.save(); ctx.translate(318, 138); ctx.rotate(Math.PI / 2); text('structured context', 0, 0, '#648bb1', 9); ctx.restore();
    ctx.save(); ctx.translate(291, 363); ctx.rotate(-Math.PI / 2); text('messages · tool results · evidence', 0, 0, '#5e7d9b', 9); ctx.restore();

    // A deterministic gear, builder, checking scales and rejected-result bin.
    ctx.save(); ctx.translate(471, 59); ctx.rotate(isActive ? motion * .75 : 0);
    for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillStyle = '#3188c3'; ctx.fillRect(-3, -15, 6, 8); }
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.fillStyle = '#3188c3'; ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fillStyle = C.bg; ctx.fill(); ctx.restore();
    rect(437, 84, 67, 66, '#0e1725', d.running && d.stage === 'execute' ? C.blue : '#2c354d', 6, 2);
    text(isActive && (Math.floor(motion * 2) % 3) ? 'build' : 'idle', 470, 119, '#62738d', 11, false, 'center');
    const lastFailure = d.events?.findLast(e => e.type === 'tool.end' && e.ok === false);
    const failureAge = lastFailure ? (d.demo ? d.startedAt + d.elapsed - lastFailure.at : Date.now() - lastFailure.at) : Infinity;
    const rejecting = failureAge >= 0 && failureAge < 1300;
    const checkColor = rejecting ? C.red : C.cyan;
    ctx.save(); ctx.translate(562, 49); ctx.rotate(rejecting ? -.17 * Math.sin(motion * 5) : .07 * Math.sin(motion * 2));
    line(-22, 0, 21, 0, checkColor, 2); line(0, -5, 0, 23, checkColor, 2);
    for (const side of [-18, 18]) { line(side, 0, side, 10, checkColor); ctx.beginPath(); ctx.moveTo(side - 7, 10); ctx.lineTo(side + 7, 10); ctx.lineTo(side, 0); ctx.closePath(); ctx.fillStyle = checkColor; ctx.fill(); }
    line(-11, 23, 11, 23, checkColor, 2); ctx.restore();
    rect(527, 82, 70, 68, '#0c1b2b', rejecting ? C.red : '#4388ae', 6, 2);
    text(rejecting ? 'retry ≠' : completed.length ? 'result ==' : 'result ?', 562, 107, rejecting ? C.red : C.text, 10, true, 'center');
    text(d.checks?.length ? '+ checks' : 'verify', 562, 128, checkColor, 10, true, 'center');
    if (rejecting) { ctx.globalAlpha = .65 + .25 * pulse; ctx.beginPath(); ctx.arc(562, 116, 43 + pulse * 5, 0, 7); ctx.strokeStyle = C.red; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1; }
    rect(620, 49, 66, 88, '#11151f', '#4b2938', 7);
    text('rejected', 653, 64, '#8a8191', 9, false, 'center');
    for (let i = 0; i < Math.min(4, failedCount); i++) rect(630, 78 + i * 8, 46, 5, '#36121d', C.red, 2, 1);
    line(630, 112, 676, 112, '#412739');
    text(`${failedCount} failed`, 653, 125, C.red, 10, true, 'center');
    ctx.beginPath(); ctx.moveTo(385, 68); ctx.lineTo(371, 92); ctx.lineTo(399, 92); ctx.closePath(); ctx.fillStyle = '#c43c50'; ctx.fill(); text('!', 385, 86, '#0b1119', 13, true, 'center'); text('retry', 385, 113, '#c94159', 10, false, 'center');

    // Conveyor: moving diagonal slats, rotating rollers, file cards and result tiles.
    rect(17, 160, 671, 17, '#111b29', '#283347', 8, 1);
    ctx.save(); ctx.beginPath(); ctx.rect(21, 161, 662, 14); ctx.clip();
    for (let x = -20; x < 710; x += 24) line(x + (motion * 19) % 24, 173, x + 10 + (motion * 19) % 24, 162, '#304055', 1);
    ctx.restore();
    for (let x = 31; x < 688; x += 46) {
      ctx.beginPath(); ctx.arc(x, 185, 5, 0, 7); ctx.fillStyle = '#1d2a3c'; ctx.fill(); ctx.strokeStyle = '#34415a'; ctx.lineWidth = .8; ctx.stroke();
      line(x - Math.cos(motion * 2) * 3, 185 - Math.sin(motion * 2) * 3, x + Math.cos(motion * 2) * 3, 185 + Math.sin(motion * 2) * 3, '#43516b', .7);
    }
    for (let i = 0; i < (isActive ? 7 : 0); i++) {
      const x = 27 + ((motion * 43 + i * 97) % 645), before = x < 300;
      const failCard = rejecting && x > 350 && x < 460;
      rect(x, 142, 32, 18, '#0c1724', failCard ? C.red : before ? C.blue : C.white, 3, 1.7);
      line(x + 5, 148, x + 23, 148, before ? C.blue : C.white, 1.2);
      line(x + 5, 153, x + 18, 153, before ? C.blue : C.white, 1.2);
      if (before) { ctx.beginPath(); ctx.arc(x + 26, 149, 2, 0, 7); ctx.fillStyle = C.cyan; ctx.fill(); }
      if (x > 470) { rect(x + 4, 143, 23, 17, '#0c1e2c', C.cyan, 3, 1); text('fn', x + 15, 155, C.cyan, 8, true, 'center'); }
    }
    if (d.running && completed.length) { const ty = 197 + ((motion * 39) % 38); rect(636, ty, 30, 16, '#0d2130', '#318aaf', 3, 1); text('fn', 651, ty + 11, C.cyan, 8, true, 'center'); }
    text('ROOM A · READER', 12, 203, '#60718b', 10);
    text('ROOM B · BUILDER', 322, 203, '#60718b', 10);

    // The left room accumulates source context and a scrolling notes ledger.
    line(73, 212, 73, 344, '#29374b'); line(73, 344, 173, 344, '#29374b');
    const stackCount = Math.min(21, 4 + Math.floor(completed.length / 4));
    for (let i = 0; i < stackCount; i++) rect(80 + i % 2 * 2, 336 - i * 5.2, 88, 4.2, i % 3 === 0 ? '#283b59' : '#253149', null, 1);
    rect(184, 211, 105, 145, '#0f1a29', '#263348', 5, 1);
    text('NOTES.md', 193, 228, '#bccadf', 10, true);
    const notes = completed.slice(-9);
    for (let i = 0; i < notes.length; i++) {
      const item = notes[i], y = 244 + i * 11;
      ctx.beginPath(); ctx.arc(195, y - 3, 2.2, 0, 7); ctx.fillStyle = item.end?.ok ? [C.cyan, '#8890f5', '#73829a'][i % 3] : C.red; ctx.fill();
      text(`s${String(Math.floor((completed.length - notes.length + i) / 8) + 1).padStart(2, '0')} ${item.end?.ok ? 'obs' : 'unk'} ${String(item.args?.procedure || item.name).slice(-3)}`, 204, y, '#7d8da7', 8.4);
    }
    text('context stays here', 81, 363, '#8a96aa', 11);
    text(d.summary ? `${completedCount} total · ${completed.length} retained` : `${completed.length} results retained`, 64, 380, C.blue, 11);
    text('obs', 208, 379, C.cyan, 9); text('inf', 239, 379, '#8c92ec', 9); text('unk', 266, 379, '#8791a6', 9);

    // Dense matrix: a progress illustration for DEMO, actual call cells for live tasks.
    const cols = 41, rows = 17, size = 6.5, gap = 2.3, mx = 328, my = 227;
    text(d.demo ? 'illustrated progress · simulated' : 'one cell = one retained call', mx, 220, '#5b6d85', 8.8);
    const filled = d.demo ? Math.round(8 + clamp((successful.length - 7) / Math.max(1, d.total - 7), 0, 1) * (cols * rows - 8)) : Math.min(cols * rows, successful.length);
    const pending = calls.filter(c => c.pending).length;
    const visibleCalls = d.demo ? null : calls.slice(-cols * rows);
    for (let i = 0; i < cols * rows; i++) {
      let color = '#162334';
      if (i < filled) color = i >= filled - 10 ? '#9ecff9' : i % 17 === 0 ? '#61c0fa' : '#2298ee';
      if (i >= filled && i < filled + (d.demo ? pending * 5 : pending)) color = pulse > .45 ? '#5dcff7' : '#205675';
      if (d.demo && rejecting && i < filled && i > Math.max(0, filled - 25) && i % 9 === 0) color = C.red;
      if (visibleCalls) {
        const call = visibleCalls[i];
        color = !call ? '#162334' : call.pending ? pulse > .45 ? C.cyan : '#205675' : call.end?.ok ? C.blue : C.red;
      }
      ctx.fillStyle = color; ctx.fillRect(mx + i % cols * (size + gap), my + Math.floor(i / cols) * (size + gap), size, size);
    }
    if (rejecting) text(`${failed.length} flagged · retrying`, mx, 389, C.red, 10);
    else text(d.demo ? 'progress illustration' : 'tool call results', mx, 389, '#6e839d', 10);
    text(`completed ${successfulCount} / ${d.total || calls.length || '—'}`, 681, 389, C.blue, 11, true, 'right');
    // Quiet labels stay fixed while the actual event state drives the machines.
    const countText = `${failedCount} failed`, labelBounds = labelMetrics(ctx, countText, '600 10px Consolas, monospace', 653, 125);
    const countBounds = { x: sceneX + labelBounds.x * scale, y: sceneY + labelBounds.y * scale, width: labelBounds.width * scale, height: labelBounds.height * scale };
    const machines = [[65, 49, 120, 101], [437, 84, 67, 66], [527, 82, 70, 68]].map(([x, y, width, height]) => ({ x: sceneX + x * scale, y: sceneY + y * scale, width: width * scale, height: height * scale }));
    this.stats = { completed: successfulCount, failed: failedCount, retainedCalls: calls.length, phase, time, cells: filled, rejecting, layout: 'square-factory', bounds: { content: { x: sceneX, y: sceneY, width: 700 * scale, height: 390 * scale }, machines, rejected: { x: sceneX + 620 * scale, y: sceneY + 49 * scale, width: 66 * scale, height: 88 * scale, countText, countBounds, countBaseline: sceneY + 125 * scale, bottomPadding: (137 - labelBounds.y - labelBounds.height) * scale, storedBottom: sceneY + 107 * scale, countPlacement: 'inside-bin' }, belt: { x: sceneX + 17 * scale, y: sceneY + 160 * scale, width: 671 * scale, height: 17 * scale, cardTop: sceneY + 142 * scale }, bottomPadding: sceneY, horizontalCoverage: 700 * scale / this.width } };
  }
}

function labelMetrics(ctx, value, font, centerX, baseline) {
  ctx.save(); ctx.font = font; ctx.textAlign = 'center'; const metrics = ctx.measureText(value); ctx.restore();
  const ascent = metrics.actualBoundingBoxAscent || 9, descent = metrics.actualBoundingBoxDescent || 0;
  return { x: centerX - metrics.actualBoundingBoxLeft, y: baseline - ascent, width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight, height: ascent + descent };
}

// A wide preview lays out the machines in native pixels. It keeps their shapes
// and glyphs proportional while letting the belt, notes and results use the width.
function drawWideDemoFactory(view, forcedMs) {
  const { ctx, canvas, data: d } = view, w = view.width, h = view.height, pixel = view.dpr || 1;
  const calls = d.calls || [], completed = calls.filter(call => !call.pending), successful = completed.filter(call => call.end?.ok === true), failed = completed.filter(call => call.end?.ok === false);
  const reference = d.reference, successCount = reference?.matched ?? successful.length, failedCount = reference?.rejected ?? failed.length, total = reference ? 697 : d.total || calls.length;
  const time = reference ? forcedMs === undefined ? reference.seconds : forcedMs / (d.duration || 24800) * 24.8 : forcedMs === undefined ? view.time() : forcedMs / 1000, motion = reference ? time : d.running ? time : (d.elapsed || 0) / 1000, pulse = .5 + .5 * Math.sin(motion * 5);
  const lastFailure = d.events?.findLast(event => event.type === 'tool.end' && event.ok === false), age = lastFailure ? d.startedAt + d.elapsed - lastFailure.at : Infinity, rejecting = reference ? [7.7667, 11.6333, 20.3667].some(seconds => time >= seconds && time < seconds + .46) : age >= 0 && age < 1300;
  const full = h >= 290, margin = 14, beltY = full ? 170 : Math.max(94, h - 54), top = 38;
  const readerX = 28, readerW = clamp(w * .2, 130, 260), machineH = clamp(beltY - top - 24, 42, 104);
  const contextX = w * .39, buildX = w * .57, checkX = w * .75, binW = 80, binX = w - margin - binW, binY = 35, binH = clamp(machineH - 8, 42, 88);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(pixel, 0, 0, pixel, 0, 0);
  const text = (value, x, y, color = C.dim, size = 11, bold = false, align = 'left') => { ctx.font = `${bold ? '600 ' : ''}${size}px "Cascadia Mono", Consolas, monospace`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(String(value), x, y); ctx.textAlign = 'left'; };
  const box = (x, y, width, height, fill, stroke, radius = 5, thickness = 1) => { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = thickness; ctx.stroke(); } };
  const line = (x, y, xx, yy, color = C.line, thickness = 1) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xx, yy); ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.stroke(); };
  text('01 READ', readerX + readerW / 2, 20, C.text, 12, true, 'center'); text(reference ? '02 SPEC.md' : '02 CONTEXT', contextX, 20, C.text, 12, true, 'center'); text('03 BUILD', buildX, 20, C.text, 12, true, 'center'); text(reference ? '04 ORACLE' : '04 CHECK', checkX, 20, C.text, 12, true, 'center');
  box(readerX, top, readerW, machineH, '#0c1725', C.blue, 6, 1.7);
  text(d.sourceLabel || 'REA', readerX + 10, top + 18, C.blue, 14, true);
  const lines = d.readerLines?.length ? d.readerLines : ['waiting for tool data', 'no target loaded'];
  ctx.save(); ctx.beginPath(); ctx.rect(readerX + 9, top + 25, readerW - 18, machineH - 31); ctx.clip();
  const visibleLines = Math.max(1, Math.floor((machineH - 31) / 12));
  for (let i = 0; i < visibleLines + 1; i++) text(String(lines[(i + Math.floor(motion * .7)) % lines.length]).slice(0, Math.floor((readerW - 20) / 6)), readerX + 10, top + 37 + i * 12 - (d.running ? motion * 8 % 12 : 0), '#8497b2', 10);
  ctx.restore();
  if (d.running && machineH >= 65) line(readerX + 4, top + 27 + motion * 23 % (machineH - 33), readerX + readerW - 4, top + 27 + motion * 23 % (machineH - 33), '#65c7ff', 1.5);
  const glow = ctx.createLinearGradient(contextX - 7, 0, contextX + 7, 0); glow.addColorStop(0, '#48ceef00'); glow.addColorStop(.5, '#48ceefaa'); glow.addColorStop(1, '#48ceef00'); ctx.fillStyle = glow; ctx.fillRect(contextX - 7, 33, 14, (full ? h - 43 : beltY + 13) - 33); line(contextX, 33, contextX, full ? h - 10 : beltY + 13, C.cyan, 2);
  ctx.save(); ctx.translate(contextX + 15, top + 8); ctx.rotate(Math.PI / 2); text(reference ? 'spec only · no code · no addresses' : full ? 'structured context · tool results' : 'context', 0, 0, '#7b9ab7', 10); ctx.restore();
  const builderH = Math.min(68, machineH), builderY = top + machineH - builderH, checkColor = rejecting ? C.red : C.cyan;
  if (machineH > 80) { ctx.save(); ctx.translate(buildX, builderY - 15); ctx.rotate(d.running ? motion * .75 : 0); for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillStyle = '#3188c3'; ctx.fillRect(-2.5, -12, 5, 7); } ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  const building = reference ? reference.builderBlue > 100 : d.running && Math.floor(motion * 2) % 3;
  box(buildX - 36, builderY, 72, builderH, '#0e1725', building ? C.blue : '#355571', 6, 1.5); text(building ? 'build' : 'idle', buildX, builderY + builderH / 2 + 4, '#93aac5', 12, false, 'center');
  box(checkX - 39, builderY, 78, builderH, '#0c1b2b', checkColor, 6, 1.5); text(reference ? rejecting ? 'bytes ≠' : 'bytes ==' : rejecting ? 'retry ≠' : 'result ==', checkX, builderY + builderH / 2 + (builderH > 55 ? -3 : 4), rejecting ? C.red : C.text, 11, true, 'center'); if (builderH > 55) text(reference ? reference.constants ? '+ const' : 'oracle' : d.checks?.length ? '+ checks' : 'verify', checkX, builderY + builderH / 2 + 16, checkColor, 10, true, 'center');
  if (rejecting) { ctx.save(); ctx.globalAlpha = .6 + .25 * pulse; ctx.beginPath(); ctx.arc(checkX, builderY + builderH / 2, 44 + pulse * 4, 0, Math.PI * 2); ctx.strokeStyle = C.red; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); }
  // The count stays inside its own bin, above every travelling card.
  box(binX, binY, binW, binH, '#11151f', '#4b2938', 7); text('rejected', binX + binW / 2, binY + 16, '#9d91a3', 10, false, 'center');
  if (binH >= 70) for (let i = 0; i < Math.min(4, failedCount); i++) box(binX + 12, binY + 27 + i * 7, binW - 24, 4, '#36121d', C.red, 2);
  const countBaseline = binY + binH - 12, countText = reference ? `${failedCount} / 3` : `${failedCount} failed`;
  text(countText, binX + binW / 2, countBaseline, C.red, 11, true, 'center');
  box(margin, beltY, w - margin * 2, 16, '#111b29', '#304057', 8);
  ctx.save(); ctx.beginPath(); ctx.rect(margin + 2, beltY + 1, w - margin * 2 - 4, 13); ctx.clip(); for (let x = -20; x < w; x += 25) line(x + motion * 19 % 25, beltY + 13, x + 10 + motion * 19 % 25, beltY + 2, '#32445b'); ctx.restore();
  for (let x = margin + 16; x < w - margin; x += 46) { ctx.beginPath(); ctx.arc(x, beltY + 23, 4, 0, Math.PI * 2); ctx.fillStyle = '#26374d'; ctx.fill(); }
  const cardCount = clamp(Math.floor(w / 100), 7, 15), travel = w - margin * 2 - 38;
  if (d.running) for (let i = 0; i < cardCount; i++) { const x = margin + 5 + (motion * 43 + i * travel / cardCount) % travel, color = x < contextX ? C.blue : C.white; box(x, beltY - 18, 32, 18, '#0c1724', color, 3, 1.5); line(x + 5, beltY - 12, x + 24, beltY - 12, color); line(x + 5, beltY - 7, x + 19, beltY - 7, color); }
  const filled = reference?.matched ?? Math.round(8 + clamp((successful.length - 7) / Math.max(1, d.total - 7), 0, 1) * 689);
  if (full) {
    const lowerY = beltY + 64, lowerH = h - lowerY - 35, stackW = clamp(readerW * .65, 100, 170), notesX = readerX + stackW + 22, notesW = contextX - notesX - 24;
    text('ROOM A · READER', margin, beltY + 46, '#7c8ca5', 11); text('ROOM B · BUILDER', contextX + 24, beltY + 46, '#7c8ca5', 11);
    const stackCount = Math.min(22, 4 + Math.floor(completed.length / 4)); line(readerX, lowerY, readerX, lowerY + lowerH, '#2c4058'); line(readerX, lowerY + lowerH, readerX + stackW + 10, lowerY + lowerH, '#2c4058');
    for (let i = 0; i < stackCount; i++) box(readerX + 6 + i % 2 * 2, lowerY + lowerH - 7 - i * Math.min(5, (lowerH - 12) / 22), stackW, 4, i % 3 ? '#26364e' : '#30445f', null, 1);
    box(notesX, lowerY - 4, notesW, lowerH + 4, '#0f1a29', '#2a3c53', 5); text('NOTES.md', notesX + 10, lowerY + 13, '#bdd0e8', 11, true);
    const noteCount = Math.max(0, Math.min(8, Math.floor((lowerH - 28) / 12))), notes = noteCount ? completed.slice(-noteCount) : [];
    notes.forEach((call, i) => text(`${call.end?.ok ? 'obs' : 'unk'}  ${String(call.name).slice(0, Math.floor((notesW - 56) / 6))}`, notesX + 10, lowerY + 31 + i * 12, call.end?.ok ? '#8ba6c6' : C.red, 10));
    const mx = contextX + 24, mw = w - margin - mx, my = lowerY + 7, mh = lowerH - 7, cols = clamp(Math.round(Math.sqrt(697 * mw / Math.max(1, mh))), 41, 85), rows = Math.ceil(697 / cols), sx = mw / cols, sy = mh / rows, size = Math.max(2, Math.min(sx, sy) - 2);
    text(reference ? 'one cell = one function · simulated' : 'illustrated progress · simulated', mx, lowerY - 4, '#8396b0', 10);
    for (let i = 0; i < 697; i++) { ctx.fillStyle = i < filled ? i >= filled - 10 ? '#a0d4fa' : '#299ef1' : '#17263a'; if (reference ? reference.gridFlags?.includes(i) : rejecting && i > filled - 25 && i < filled && i % 9 === 0) ctx.fillStyle = C.red; ctx.fillRect(mx + i % cols * sx, my + Math.floor(i / cols) * sy, size, size); }
    if (reference?.callout) { ctx.save(); ctx.globalAlpha = reference.calloutOpacity ?? 1; const color = reference.callout === 'bug' ? C.red : C.cyan; box(mx, my + 4, mw, 40, '#0b1422f5', color, 5, 1.5); text(reference.callout === 'bug' ? 'BUG · passed the byte check' : 'TEST THE ORACLE TOO', mx + 12, my + 20, color, 11, true); text(reference.callout === 'bug' ? 'power check 0.0, original 128.0' : 'now comparing constant bytes', mx + 12, my + 35, C.text, 10); ctx.restore(); }
    text(reference ? `${reference.sourceLines} asm lines kept` : `${completed.length} results retained`, readerX, h - 12, C.blue, 11);
    text(reference ? `exact match ${successCount} / 697 · day ${String(reference.day).padStart(2, '0')}` : `completed ${successCount} / ${total}`, w - margin, h - 12, C.blue, 11, true, 'right');
  } else text(reference ? `SIMULATED · ${reference.read} read · ${successCount} matched · ${reference.open} open · day ${reference.day}` : `SIMULATED · ${successCount} success · ${failedCount} failed · ${calls.filter(call => call.pending).length} pending`, margin, h - 12, '#9cb1ce', 11);
  const countBounds = labelMetrics(ctx, countText, '600 11px "Cascadia Mono", Consolas, monospace', binX + binW / 2, countBaseline);
  const machines = [{ x: readerX, y: top, width: readerW, height: machineH }, { x: buildX - 36, y: builderY, width: 72, height: builderH }, { x: checkX - 39, y: builderY, width: 78, height: builderH }];
  return { completed: successCount, failed: failedCount, retainedCalls: calls.length, phase: reference?.day ?? Math.min(11, Math.floor((d.progress || 0) * 12)), time, cells: filled, rejecting, simulated: true, layout: full ? 'wide-factory' : 'compact-factory', bounds: { content: { x: margin, y: 12, width: w - margin * 2, height: h - 24 }, machines, rejected: { x: binX, y: binY, width: binW, height: binH, countText, countBounds, countBaseline, bottomPadding: binY + binH - countBounds.y - countBounds.height, storedBottom: binH >= 70 ? binY + 52 : null, countPlacement: 'inside-bin' }, belt: { x: margin, y: beltY, width: w - margin * 2, height: 16, cardTop: beltY - 18 }, bottomPadding: 10, horizontalCoverage: (w - margin * 2) / w } };
}

// Live tasks use CSS pixels instead of scaling the detailed promotional scene.
// Every count and result tile here is backed by an observed event or run total.
function liveVisualState(data) {
  if (['idle', 'working', 'waiting', 'failed', 'completed', 'cancelled', 'disconnected'].includes(data.visualState)) return data.visualState;
  if (data.running) return (data.summary?.pending ?? data.calls?.filter(call => call.pending).length) ? 'working' : 'waiting';
  return (data.summary?.calls || data.calls?.length) ? 'completed' : 'idle';
}

function drawLiveFactory(view, forcedMs) {
  const { ctx, canvas, data: d } = view;
  const width = view.width, height = view.height, dpr = view.dpr || 1;
  const calls = d.calls || [], successful = calls.filter(call => !call.pending && call.end?.ok === true);
  const failed = calls.filter(call => !call.pending && call.end?.ok === false);
  const successCount = d.summary?.success ?? successful.length, failedCount = d.summary?.errors ?? failed.length;
  const pendingCount = d.summary?.pending ?? calls.filter(call => call.pending).length;
  const totalCount = d.summary?.calls ?? calls.length;
  const visualState = liveVisualState(d), working = visualState === 'working', waiting = visualState === 'waiting';
  const animated = !d.paused && !document.hidden && !view.reducedMotion.matches && (working || waiting);
  const time = animated ? (forcedMs === undefined ? view.time() : forcedMs / 1000) : 0;
  const pulse = animated ? .5 + .5 * Math.sin(time * 3) : .6;
  const color = { idle: '#7890a9', working: C.blue, waiting: '#d8ad63', failed: C.red, completed: C.cyan, cancelled: '#929cad', disconnected: '#d8ad63' }[visualState];
  const labels = { idle: 'READY', working: 'WORKING', waiting: 'WAITING', failed: 'FAILED', completed: 'COMPLETED', cancelled: 'CANCELLED', disconnected: 'DISCONNECTED' };
  const defaults = { idle: 'Connect a tool or start a task', working: 'Tools are executing', waiting: 'Awaiting the next agent event', failed: 'Task ended with an error', completed: 'Task finished', cancelled: 'Task was stopped', disconnected: 'Reconnecting to the event stream' };
  const latest = calls.at(-1), current = calls.findLast(call => call.pending) || latest;
  const cols = width >= 780 ? 5 : width >= 520 ? 3 : 2, rows = Math.ceil(5 / cols);
  const margin = width < 520 ? 10 : 14, gap = width < 520 ? 10 : 20;
  const top = 34, footer = rows === 1 || height >= rows * 68 + 60 ? 32 : 12;
  const nodeWidth = (width - margin * 2 - gap * (cols - 1)) / cols;
  const rowGap = rows > 1 ? 12 : 0, nodeHeight = Math.max(42, Math.min(98, (height - top - footer - rowGap * (rows - 1)) / rows));
  const compact = nodeHeight < 80;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const font = (size = 12, bold = false) => `${bold ? '600 ' : ''}${size}px "Cascadia Mono", "Segoe UI", Consolas, monospace`;
  const text = (value, x, y, fill = C.dim, size = 12, bold = false) => { ctx.font = font(size, bold); ctx.fillStyle = fill; ctx.fillText(String(value), x, y); };
  const fit = (value, available, size = 12, bold = false) => {
    let str = String(value || ''); ctx.font = font(size, bold);
    if (ctx.measureText(str).width <= available) return str;
    while (str.length && ctx.measureText(`${str}…`).width > available) str = str.slice(0, -1);
    return `${str}…`;
  };
  const line = (x, y, xx, yy, stroke = C.line, thickness = 1) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xx, yy); ctx.strokeStyle = stroke; ctx.lineWidth = thickness; ctx.stroke(); };
  const box = (x, y, w, h, fill, stroke, thickness = 1, radius = 7) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = thickness; ctx.stroke(); } };
  const dot = (x, y, radius, fill) => { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  text('LIVE EVENT PIPELINE', margin, 20, '#9baec6', 11, true);
  const statusWidth = ctx.measureText(labels[visualState]).width + 23;
  dot(width - margin - statusWidth + 3, 16, 3, color);
  text(labels[visualState], width - margin - statusWidth + 14, 20, color, 11, true);
  const nodes = [
    { key: '01 SOURCE', title: d.sourceLabel || 'MCP / AGENT', detail: totalCount ? `${totalCount} calls observed` : 'No calls received', accent: '#6294c0' },
    { key: '02 CONTEXT', title: `${d.events?.length || 0} events retained`, detail: 'Messages · parameters', accent: '#959cf0' },
    { key: '03 TOOLS', title: current?.name || 'Ready for a call', detail: pendingCount ? `${pendingCount} in flight` : `${totalCount} calls total`, accent: C.blue },
    { key: '04 RESULTS', title: `${successCount} success · ${failedCount} failed`, detail: `${calls.length} call details retained`, accent: failedCount ? '#b6a4b4' : C.cyan },
    { key: '05 SESSION', title: labels[visualState], detail: d.statusMessage || defaults[visualState], accent: color },
  ];
  const activeNode = working ? 2 : waiting ? 4 : -1;
  const positions = nodes.map((node, index) => ({ x: margin + index % cols * (nodeWidth + gap), y: top + Math.floor(index / cols) * (nodeHeight + rowGap) }));
  // The connections remain still unless an actual task is executing tools.
  positions.forEach((position, index) => {
    if (index === 4) return;
    const next = positions[index + 1];
    if (next.y !== position.y) return;
    const x = position.x + nodeWidth + 3, xx = next.x - 3, y = position.y + nodeHeight / 2;
    line(x, y, xx, y, working ? '#315b7c' : '#26384b');
    line(xx - 4, y - 3, xx, y, working ? '#497ca2' : '#394b60'); line(xx - 4, y + 3, xx, y, working ? '#497ca2' : '#394b60');
    if (animated && working) dot(x + ((time * .7 + index * .21) % 1) * (xx - x - 3), y, 2, C.cyan);
  });
  nodes.forEach((node, index) => {
    const { x, y } = positions[index], active = index === activeNode;
    const terminal = index === 4 && ['failed', 'completed', 'cancelled', 'disconnected'].includes(visualState);
    box(x, y, nodeWidth, nodeHeight, active ? '#0d2031' : '#0c1826', active || terminal ? node.accent : '#27394e', active ? 1.5 : 1);
    box(x + 1, y + 8, 2, Math.max(8, nodeHeight - 16), node.accent, null, 1, 1);
    text(node.key, x + 12, y + 20, '#8296b2', 11, true);
    const titleY = y + (compact ? 39 : 45), contentWidth = nodeWidth - 24;
    text(fit(node.title, contentWidth, compact ? 12 : 13, true), x + 12, titleY, index === 4 ? color : '#d4dfef', compact ? 12 : 13, true);
    if (!compact) text(fit(node.detail, contentWidth, 11), x + 12, y + Math.min(65, nodeHeight - 22), '#8ca1bc', 11);
    if (waiting && index === 4) {
      ctx.save(); ctx.globalAlpha = .4 + pulse * .6; dot(x + nodeWidth - 13, y + 15, 3, color); ctx.restore();
    }
    if (working && index === 2 && !compact && animated) {
      const scanX = x + 13 + ((time * .5) % 1) * (nodeWidth - 26);
      line(x + 12, y + nodeHeight - 13, x + nodeWidth - 12, y + nodeHeight - 13, '#1c405a', 2);
      line(scanX, y + nodeHeight - 17, scanX, y + nodeHeight - 9, C.blue, 2);
    }
    if (index === 3 && !compact) {
      const tileSize = 5, tileGap = 3, shown = calls.slice(-Math.min(24, Math.floor(contentWidth / (tileSize + tileGap))));
      shown.forEach((call, cell) => { ctx.fillStyle = call.pending ? '#d8ad63' : call.end?.ok === true ? C.cyan : call.end?.ok === false ? C.red : '#4b6079'; ctx.fillRect(x + 12 + cell * (tileSize + tileGap), y + nodeHeight - 17, tileSize, tileSize); });
    }
    if (index === 4 && visualState === 'completed' && !compact) {
      line(x + nodeWidth - 27, y + nodeHeight - 18, x + nodeWidth - 23, y + nodeHeight - 14, C.cyan, 2);
      line(x + nodeWidth - 23, y + nodeHeight - 14, x + nodeWidth - 15, y + nodeHeight - 22, C.cyan, 2);
    }
  });
  const nodesBottom = top + rows * nodeHeight + (rows - 1) * rowGap;
  if (height - nodesBottom >= 23) {
    const footerY = Math.min(height - 10, nodesBottom + 24);
    const countText = `${totalCount} calls  /  ${pendingCount} in flight  /  ${successCount} success  /  ${failedCount} failed`;
    text(fit(rows === 1 ? countText : d.statusMessage || defaults[visualState], width - margin * 2, 11), margin, footerY, '#8296b2', 11);
    if (rows === 1 && width > 1000) {
      const note = 'Result tiles = retained calls'; ctx.font = font(11); const noteWidth = ctx.measureText(note).width;
      text(note, width - margin - noteWidth, footerY, '#68819c', 11);
    }
  }
  return { completed: successCount, failed: failedCount, retainedCalls: calls.length, phase: d.stage || visualState, time, cells: Math.min(24, calls.length), rejecting: visualState === 'failed', visualState, activeMotions: animated ? working ? 2 : waiting ? 1 : 0 : 0, motionTypes: animated ? working ? ['transfer', 'scanner'] : waiting ? ['heartbeat'] : [] : [], layout: { cols, rows, nodeWidth, nodeHeight }, pending: pendingCount };
}

// BEGIN GENERATED REFERENCE MODULE
// Source: reference-factory.js. Update with npm run build:reference.
// Native Canvas reconstruction. Coordinates are measured in the 684 × 395
// factory viewport of the 1080 × 1080 reference, not an embedded video.
const P = { bg: '#09121c', dim: '#68758b', blue: '#299fff', cyan: '#45c8ef', red: '#fa3f5b', text: '#ced7e4', line: '#263248' };
const clamp01 = n => Math.max(0, Math.min(1, n));
const smooth = n => { const u = clamp01(n); return u * u * (3 - 2 * u); };
const faults = [7.7667, 11.6333, 20.3667];
// Falling fn tile per reference frame: drop below the belt (px) and opacity.
const FN_DROP = [0, 1, 3, 5, 9, 15, 21.5, 28.5, 35.5, 42.5, 49.5, 56, 62.5, 69.5, 76];
const FN_FADE = [1, 1, 1, 1, 1, 1, 1, .8, .55, .45, .35, .25, .15, .07, 0];
const NOTE_COLORS = { obs: P.cyan, inf: '#8a91ef', unk: '#6f7d90' };
const FAULT_LABELS = ['const+1', 'branch≠', 'off-by-1'];
// Rejected tile per reference frame from 14 frames after a fault: centre x, y and opacity into the bin.
const FAULT_PATH = [[555, 136, 1], [557, 136, 1], [559, 136, 1], [563, 128, 1], [568, 118, 1], [574, 106, 1], [581, 95, 1], [588, 84, 1], [595, 78, 1],
  [603, 72, 1], [610, 70, 1], [617, 70, 1], [624, 72, 1], [630, 76, 1], [634, 84, .8], [636, 90, .55], [637, 93, .3], [638, 94, 0]];
const READER_LINES = ['CMP EAX, 0x5c', 'JZ  0x180124aba', 'CMP EAX, 0x5b', 'MOV EDX, 0x64', 'CALL sound_pan', 'FLD [0x4b2c10]', 'RET'];

export function drawReferenceFactory(view, forcedMs) {
  const { ctx, canvas, data: d } = view, r = d.reference;
  const t = forcedMs === undefined ? r.seconds : forcedMs / (d.duration || 24800) * 24.8;
  const scale = Math.min(view.width / 684, view.height / 395), pixel = view.dpr || 1;
  const sceneX = (view.width - 684 * scale) / 2, sceneY = (view.height - 398 * scale) / 2;
  const projectRect = (x, y, width, height) => ({ x: sceneX + x * scale, y: sceneY + y * scale, width: width * scale, height: height * scale });
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Centre the visible ink (logical y15..383), rather than the unused canvas edges.
  ctx.setTransform(pixel * scale, 0, 0, pixel * scale, sceneX * pixel, sceneY * pixel);
  const text = (value, x, y, color = P.dim, size = 10, bold = false, align = 'left') => {
    ctx.font = `${bold ? '600 ' : ''}${size}px "Cascadia Mono", Consolas, monospace`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(String(value), x, y); ctx.textAlign = 'left';
  };
  const line = (x, y, xx, yy, color = P.line, width = 1) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xx, yy); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); };
  const box = (x, y, w, h, fill, stroke, radius = 4, width = 1) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); } };
  const card = (x, y, type = 'spec', angle = 0, alpha = 1, label = '') => {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(angle);
    if (type === 'hex') { box(-17, -9, 34, 18, '#1b2331', '#293143', 3); text(['0x5c', '0xd1', '0x80', '0xc4'][Math.floor(t / .968) % 4], 0, 3, '#a2adbf', 8.5, false, 'center'); ctx.restore(); return; }
    const color = type === 'read' ? P.blue : type === 'fn' ? P.cyan : type === 'bad' ? P.red : '#d0d9e8';
    box(-16, -9, 32, 18, label ? '#4a1420' : '#0c1723', color, 3, 1.7);
    if (label) { text(label, 0, 3, '#ffc9cf', 7.5, false, 'center'); ctx.restore(); return; }
    if (type === 'fn') text('fn', 0, 3, color, 9, true, 'center');
    else { line(-10, -3, 9, -3, color, 1.3); line(-10, 3, 4, 3, color, 1.3); if (type === 'read') { ctx.beginPath(); ctx.arc(10, 3, 2, 0, Math.PI * 2); ctx.fillStyle = P.cyan; ctx.fill(); } }
    ctx.restore();
  };
  const rejectionIndex = faults.findIndex(s => t >= s && t < s + .46);
  const rejecting = rejectionIndex !== -1;
  const rejected = r.rejected;
  const beat = t % .968, move = smooth((beat - .480) / .488), shift = move * 87;
  const active = t < 24.2;

  text('01 READ', 121, 24, P.text, 12, true, 'center'); text('02 SPEC.md', 296, 24, P.text, 12, true, 'center');
  text('03 BUILD', 467, 24, P.text, 12, true, 'center'); text('04 ORACLE', 556, 24, P.text, 12, true, 'center');
  // Input artifact and scanner. Text is intentionally clipped by the reader.
  ctx.beginPath(); ctx.moveTo(16, 68); ctx.lineTo(35, 68); ctx.lineTo(43, 76); ctx.lineTo(43, 103); ctx.lineTo(16, 103); ctx.closePath(); ctx.fillStyle = '#102033'; ctx.fill(); ctx.strokeStyle = '#318bca'; ctx.lineWidth = 1; ctx.stroke();
  text('01', 29, 85, '#8dd0ff', 8, false, 'center'); text('10', 29, 96, '#8dd0ff', 8, false, 'center'); text('binary', 29, 118, P.dim, 9, false, 'center');
  const readerLight = clamp01((r.readerBlue - 130) / 72), builderLight = clamp01((r.builderBlue - 53) / 92);
  ctx.save(); ctx.shadowBlur = readerLight * 8; ctx.shadowColor = '#299fff88';
  box(63, 45, 117, 98, '#0b1523', `rgb(${Math.round(50 - 9 * readerLight)},${Math.round(105 + 54 * readerLight)},${Math.round(170 + 85 * readerLight)})`, 5, 2); ctx.restore(); text('REA', 71, 63, P.blue, 15, true);
  const lit = active ? clamp01((beat - .03) / .09) * (1 - clamp01((beat - .37) / .1)) : 0, mix = (from, to) => Math.round(from + (to - from) * lit);
  ctx.beginPath(); ctx.arc(168, 57, 3, 0, Math.PI * 2); ctx.fillStyle = `rgb(${mix(23, 69)},${mix(47, 200)},${mix(80, 239)})`; ctx.fill();
  // The listing scrolls twelve lines per beat; the line in the third slot reads bright.
  ctx.save(); ctx.beginPath(); ctx.rect(69, 69, 105, 68); ctx.clip();
  const travel = active ? t * 12 * 11 / .968 : 0, first = Math.floor(travel / 11), offset = travel - first * 11;
  for (let i = -1; i < 8; i++) { const y = 82 + i * 11 - offset; text(READER_LINES[(first + i) % READER_LINES.length], 72, y, y > 93.5 && y <= 104.5 ? '#dde5f0' : '#65758e', 8.5); }
  ctx.restore();
  if (active) { const yy = 71.0746 + 68.7 * (t % .9677); ctx.save(); ctx.shadowColor = '#69b8ff'; ctx.shadowBlur = 5; line(66, yy, 176, yy, '#6cbdff', 1.8); ctx.restore(); }

  // The fixed spec boundary is continuous through the conveyor.
  const glow = ctx.createLinearGradient(289, 0, 302, 0); glow.addColorStop(0, '#47c9f000'); glow.addColorStop(.48, '#47c9f038'); glow.addColorStop(.62, '#4cccf0a0'); glow.addColorStop(1, '#47c9f000');
  ctx.fillStyle = glow; ctx.fillRect(289, 35, 13, 348); line(295, 35, 295, 383, '#43b8e0', 3);
  ctx.save(); ctx.translate(313, 164); ctx.rotate(-Math.PI / 2); text('behaviour only', 0, 0, '#5d7794', 9); ctx.restore();
  ctx.save(); ctx.translate(284, 328); ctx.rotate(-Math.PI / 2); text('no code · no addresses', 0, 0, '#5b7591', 9); ctx.restore();

  ctx.save(); ctx.translate(467, 54); ctx.rotate(t * .85);
  for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillStyle = '#2c8aca'; ctx.fillRect(-2.5, -13, 5, 7); }
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fillStyle = '#2c8aca'; ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fillStyle = P.bg; ctx.fill(); ctx.restore();
  const building = builderLight > .55;
  box(435, 79, 64, 64, '#101825', `rgb(${Math.round(42 - builderLight)},${Math.round(50 + 109 * builderLight)},${Math.round(73 + 182 * builderLight)})`, 5, 2); text(building ? 'build' : 'idle', 467, 114, building ? '#8eb9df' : '#66718a', 11, false, 'center');
  // Rejection swells over half a second; ordinary beats pulse the box blue for the first half.
  const alarm = rejecting ? Math.sin(Math.PI * clamp01((t - faults[rejectionIndex]) / .5)) : 0;
  const pulse = !rejecting && active && beat >= .02 && beat < .47 ? Math.sin(Math.PI * (beat - .02) / .45) : 0;
  const tint = (from, to, k) => `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * k)).join(',')})`;
  const color = rejecting ? P.red : P.cyan;
  ctx.save(); ctx.translate(556, 43); ctx.rotate(rejecting ? -.45 * alarm : .025 * Math.sin(t * 2));
  line(-20, 0, 20, 0, color, 2); line(0, -4, 0, 22, color, 2); line(-9, 22, 9, 22, color, 2);
  for (const side of [-16, 16]) { line(side, 0, side, 10, color); ctx.beginPath(); ctx.moveTo(side, 0); ctx.lineTo(side - 7, 10); ctx.lineTo(side + 7, 10); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); }
  ctx.restore();
  box(523, 77, 68, 66, rejecting ? tint([13, 27, 41], [59, 23, 22], alarm) : tint([13, 27, 41], [9, 41, 72], pulse), rejecting ? P.red : tint([61, 128, 159], [105, 195, 239], pulse), 6, 2);
  text(rejecting ? 'bytes ≠' : pulse > 0 ? 'bytes ==' : 'bytes ?', 557, 102, rejecting ? P.red : tint([101, 119, 142], [230, 237, 246], pulse), 11, pulse > 0, 'center');
  if (r.constants) text('+ const', 557, 122, color, 10, true, 'center');
  if (rejecting) { const p = clamp01((t - faults[rejectionIndex]) / .46); ctx.save(); ctx.globalAlpha = 1 - p * .55; ctx.beginPath(); ctx.arc(557, 111, 38 + p * 13, 0, Math.PI * 2); ctx.strokeStyle = P.red; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); }
  box(612, 49, 66, 72, '#11131e', '#422a36', 7); text('rejected', 645, 63, '#8b8190', 9, false, 'center');
  for (let i = 0; i < Math.min(3, rejected); i++) box(622, 73 + i * 8, 46, 4, '#30121a', '#e53a54', 2);
  const countText = `${rejected} / 3`, countBaseline = 111;
  text(countText, 645, countBaseline, P.red, 12, true, 'center');
  ctx.save(); ctx.textAlign = 'center'; const countMetrics = ctx.measureText(countText); ctx.restore();
  const countBounds = projectRect(645 - countMetrics.actualBoundingBoxLeft, countBaseline - countMetrics.actualBoundingBoxAscent,
    countMetrics.actualBoundingBoxLeft + countMetrics.actualBoundingBoxRight, countMetrics.actualBoundingBoxAscent + countMetrics.actualBoundingBoxDescent);
  ctx.beginPath(); ctx.moveTo(384, 64); ctx.lineTo(371, 87); ctx.lineTo(397, 87); ctx.closePath(); ctx.fillStyle = '#c63a50'; ctx.fill(); text('!', 384, 82, '#11131c', 12, true, 'center'); text('plant', 384, 107, '#cc405a', 10, false, 'center');

  box(18, 153, 654, 17, '#101b27', '#2a3345', 8);
  ctx.save(); ctx.beginPath(); ctx.rect(21, 155, 647, 13); ctx.clip();
  for (let x = -10; x < 690; x += 24) line(x + (t * 24) % 24, 166, x + 8 + (t * 24) % 24, 155, '#2c394e'); ctx.restore();
  for (let x = 32; x < 678; x += 46) { ctx.beginPath(); ctx.arc(x, 177, 5, 0, Math.PI * 2); ctx.fillStyle = '#1e293c'; ctx.fill(); ctx.strokeStyle = '#333d53'; ctx.lineWidth = .8; ctx.stroke(); }
  // Cards wait on each station for half a beat, then ease to the next station.
  // Track 541px in the original is our centre 209px (left edge 193px).
  const centers = [36, 123, 210, 297, 384, 467, 558, 642];
  for (let station = 0; station < 8; station++) {
    if (t >= 17.424 + station * .968) continue;
    const x = centers[station] + shift;
    if (x < 25 || x > 656 || station === 7 && active && beat >= .4637) continue;
    const fault = station >= 4 && station <= 6 ? faults.findIndex(s => { const age = t - (s - (6 - station) * .968); return age >= 0 && age < (station === 6 ? .46 : .968); }) : -1, bad = fault !== -1;
    const type = station < 2 ? 'hex' : x < 290 ? 'read' : x < 520 ? 'spec' : 'fn';
    card(x, 144, bad ? 'bad' : type, 0, 1, bad && station > 4 ? FAULT_LABELS[fault] : '');
    if (bad && station === 4) { for (let y = 112; y < 135; y += 5) line(384, y, 384, y + 2, P.red); }
  }
  // Assembly fragments peel off into the reader's retained code pile.
  if (t < 18.3 && beat >= .35 && beat <= .95) { const q = clamp01((beat - .35) / .60), stackTop = r.stackTop - 267; ctx.save(); ctx.translate(122, 167 + (stackTop - 167) * smooth(q)); ctx.rotate(.56 * (1 - q)); box(-16, -4, 32, 8, '#263249', null, 1); text('code', -12, 2, '#9da8ba', 7.5); ctx.restore(); }
  // Successful fn tiles drop toward the comparison matrix; rejected ones arc up.
  // Measured per frame: the tile leaves the belt end .464 s into each beat, eases in, then fades.
  if (active) { const m = (beat - .4637) * 30; if (m >= 0 && m < 14) { const k = Math.floor(m), f = m - k, at = table => table[k] + (table[k + 1] - table[k]) * f; card(642, 144 + at(FN_DROP), 'fn', 0, at(FN_FADE)); } }
  faults.forEach((s, i) => { const m = (t - s) * 30 - 14; if (m >= 0 && m < FAULT_PATH.length - 1) { const k = Math.floor(m), f = m - k, at = j => FAULT_PATH[k][j] + (FAULT_PATH[k + 1][j] - FAULT_PATH[k][j]) * f; card(at(0), at(1), 'bad', 0, at(2), FAULT_LABELS[i]); } });
  text('ROOM A · READER', 12, 195, '#5c6b84', 10); text('ROOM B · BUILDER', 318, 195, '#5c6b84', 10);
  line(72, 204, 72, 334); line(72, 334, 172, 334); line(172, 204, 172, 334);
  for (let y = r.stackTop - 267, i = 0; y <= 328; y += 5.2, i++) box(77 + i % 2 * 2, y, 91, 4.2, i % 3 ? '#27344d' : '#2d3c58', null, 1);
  box(181, 204, 94, 142, '#0e1927', '#273347', 5); text('NOTES.md', 189, 221, '#bdc8da', 10, true);
  r.notes.forEach(({ tag, address, day }, i) => { const y = 239.5 + i * 13; ctx.beginPath(); ctx.arc(190, y - 3, 2.5, 0, Math.PI * 2); ctx.fillStyle = NOTE_COLORS[tag]; ctx.fill(); text(`d${String(day).padStart(2, '0')} ${tag} ${address}`, 197, y, '#7c8aa0', 9.3); });
  text('code stays here', 67, 351, '#8b98aa', 12); text(`${r.sourceLines} asm lines kept`, 61, 369, P.blue, 11); text('obs', 189, 369, P.cyan, 9); text('inf', 219, 369, '#8b92ee', 9); text('unk', 249, 369, '#6f7d90', 9);

  const cols = 41, rows = 17, size = 6.5, gap = 2.05, mx = 320, my = 219;
  text('one cell = one function', mx, 212, '#5b6b81', 9);
  for (let i = 0; i < cols * rows; i++) {
    let fill = i < r.matched ? i >= r.matched - 9 ? '#a4d4fa' : '#299ef1' : '#152131';
    if (r.gridFlags.includes(i)) fill = P.red;
    ctx.fillStyle = fill; ctx.fillRect(mx + i % cols * (size + gap), my + Math.floor(i / cols) * (size + gap), size, size);
  }
  if (t >= 17.4667 && t < 19.3) { const scanX = mx + (t - 17.4667) * 190.9; line(scanX, my, scanX, my + 146, '#9addff', 1.5); }
  if (r.callout) {
    ctx.save(); ctx.globalAlpha = r.calloutOpacity;
    const bug = r.callout === 'bug', color = bug ? P.red : P.cyan;
    box(320, 222, 351, 37, '#0b1422f5', color, 5, 1.5);
    text(bug ? 'BUG · passed the byte check' : 'TEST THE ORACLE TOO', 332, 237, color, 10, true);
    text(bug ? 'power check 0.0, original 128.0' : t >= 18.4 ? '1,548 refs · 12 more wrong' : 'now comparing constant bytes', 332, 252, '#d5dbe7', 10);
    ctx.restore();
  }
  text(r.flagged ? `${r.flagged} flagged` : 'byte compare', 320, 379, r.flagged ? P.red : '#71849f', 11);
  text(`exact match ${r.matched} / 697`, 677, 379, r.flagged ? P.red : P.blue, 12, true, 'right');
  return { completed: r.matched, failed: rejected, phase: r.day, time: t, cells: r.matched, rejecting, shift, simulated: true, layout: 'reference-factory', bounds: {
    content: projectRect(0, 15, 684, 368),
    horizontalCoverage: 684 * scale / view.width, topPadding: sceneY + 15 * scale, bottomPadding: view.height - sceneY - 383 * scale,
    machines: [projectRect(63, 45, 117, 98), projectRect(435, 79, 64, 64), projectRect(523, 77, 68, 66)],
    rejected: { ...projectRect(612, 49, 66, 72), countText, countBounds,
      countBaseline: sceneY + countBaseline * scale, bottomPadding: sceneY + 121 * scale - countBounds.y - countBounds.height,
      storedBottom: sceneY + 93 * scale, countPlacement: 'inside-bin',
      text: { value: countText, font: '600 12px "Cascadia Mono", Consolas, monospace', x: sceneX + 645 * scale, baseline: sceneY + countBaseline * scale, scale } },
    belt: { ...projectRect(18, 153, 654, 17), cardTop: sceneY + 135 * scale }
  } };
}
