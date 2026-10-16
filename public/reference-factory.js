// Native Canvas reconstruction. Coordinates are measured in the 684 × 395
// factory viewport of the 1080 × 1080 reference, not an embedded video.
const refT = globalThis.agentBayT || (value => value);
const refTf = globalThis.agentBayTf || ((value, params = {}) => { let text = refT(value); for (const [key, item] of Object.entries(params)) text = text.replaceAll(`{${key}}`, item); return text; });
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

  text(refT('01 READ'), 121, 24, P.text, 12, true, 'center'); text(refT('02 SPEC.md'), 296, 24, P.text, 12, true, 'center');
  text(refT('03 BUILD'), 467, 24, P.text, 12, true, 'center'); text(refT('04 ORACLE'), 556, 24, P.text, 12, true, 'center');
  // Input artifact and scanner. Text is intentionally clipped by the reader.
  ctx.beginPath(); ctx.moveTo(16, 68); ctx.lineTo(35, 68); ctx.lineTo(43, 76); ctx.lineTo(43, 103); ctx.lineTo(16, 103); ctx.closePath(); ctx.fillStyle = '#102033'; ctx.fill(); ctx.strokeStyle = '#318bca'; ctx.lineWidth = 1; ctx.stroke();
  text('01', 29, 85, '#8dd0ff', 8, false, 'center'); text('10', 29, 96, '#8dd0ff', 8, false, 'center'); text(refT('binary'), 29, 118, P.dim, 9, false, 'center');
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
  ctx.save(); ctx.translate(313, 164); ctx.rotate(-Math.PI / 2); text(refT('behaviour only'), 0, 0, '#5d7794', 9); ctx.restore();
  ctx.save(); ctx.translate(284, 328); ctx.rotate(-Math.PI / 2); text(refT('no code · no addresses'), 0, 0, '#5b7591', 9); ctx.restore();

  ctx.save(); ctx.translate(467, 54); ctx.rotate(t * .85);
  for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillStyle = '#2c8aca'; ctx.fillRect(-2.5, -13, 5, 7); }
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fillStyle = '#2c8aca'; ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fillStyle = P.bg; ctx.fill(); ctx.restore();
  const building = builderLight > .55;
  box(435, 79, 64, 64, '#101825', `rgb(${Math.round(42 - builderLight)},${Math.round(50 + 109 * builderLight)},${Math.round(73 + 182 * builderLight)})`, 5, 2); text(refT(building ? 'build' : 'idle'), 467, 114, building ? '#8eb9df' : '#66718a', 11, false, 'center');
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
  text(refT(rejecting ? 'bytes ≠' : pulse > 0 ? 'bytes ==' : 'bytes ?'), 557, 102, rejecting ? P.red : tint([101, 119, 142], [230, 237, 246], pulse), 11, pulse > 0, 'center');
  if (r.constants) text(refT('+ const'), 557, 122, color, 10, true, 'center');
  if (rejecting) { const p = clamp01((t - faults[rejectionIndex]) / .46); ctx.save(); ctx.globalAlpha = 1 - p * .55; ctx.beginPath(); ctx.arc(557, 111, 38 + p * 13, 0, Math.PI * 2); ctx.strokeStyle = P.red; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); }
  box(612, 49, 66, 72, '#11131e', '#422a36', 7); text(refT('rejected'), 645, 63, '#8b8190', 9, false, 'center');
  for (let i = 0; i < Math.min(3, rejected); i++) box(622, 73 + i * 8, 46, 4, '#30121a', '#e53a54', 2);
  const countText = `${rejected} / 3`, countBaseline = 111;
  text(countText, 645, countBaseline, P.red, 12, true, 'center');
  ctx.save(); ctx.textAlign = 'center'; const countMetrics = ctx.measureText(countText); ctx.restore();
  const countBounds = projectRect(645 - countMetrics.actualBoundingBoxLeft, countBaseline - countMetrics.actualBoundingBoxAscent,
    countMetrics.actualBoundingBoxLeft + countMetrics.actualBoundingBoxRight, countMetrics.actualBoundingBoxAscent + countMetrics.actualBoundingBoxDescent);
  ctx.beginPath(); ctx.moveTo(384, 64); ctx.lineTo(371, 87); ctx.lineTo(397, 87); ctx.closePath(); ctx.fillStyle = '#c63a50'; ctx.fill(); text('!', 384, 82, '#11131c', 12, true, 'center'); text(refT('plant'), 384, 107, '#cc405a', 10, false, 'center');

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
  if (t < 18.3 && beat >= .35 && beat <= .95) { const q = clamp01((beat - .35) / .60), stackTop = r.stackTop - 267; ctx.save(); ctx.translate(122, 167 + (stackTop - 167) * smooth(q)); ctx.rotate(.56 * (1 - q)); box(-16, -4, 32, 8, '#263249', null, 1); text(refT('code'), -12, 2, '#9da8ba', 7.5); ctx.restore(); }
  // Successful fn tiles drop toward the comparison matrix; rejected ones arc up.
  // Measured per frame: the tile leaves the belt end .464 s into each beat, eases in, then fades.
  if (active) { const m = (beat - .4637) * 30; if (m >= 0 && m < 14) { const k = Math.floor(m), f = m - k, at = table => table[k] + (table[k + 1] - table[k]) * f; card(642, 144 + at(FN_DROP), 'fn', 0, at(FN_FADE)); } }
  faults.forEach((s, i) => { const m = (t - s) * 30 - 14; if (m >= 0 && m < FAULT_PATH.length - 1) { const k = Math.floor(m), f = m - k, at = j => FAULT_PATH[k][j] + (FAULT_PATH[k + 1][j] - FAULT_PATH[k][j]) * f; card(at(0), at(1), 'bad', 0, at(2), FAULT_LABELS[i]); } });
  text(refT('ROOM A · READER'), 12, 195, '#5c6b84', 10); text(refT('ROOM B · BUILDER'), 318, 195, '#5c6b84', 10);
  line(72, 204, 72, 334); line(72, 334, 172, 334); line(172, 204, 172, 334);
  for (let y = r.stackTop - 267, i = 0; y <= 328; y += 5.2, i++) box(77 + i % 2 * 2, y, 91, 4.2, i % 3 ? '#27344d' : '#2d3c58', null, 1);
  box(181, 204, 94, 142, '#0e1927', '#273347', 5); text('NOTES.md', 189, 221, '#bdc8da', 10, true);
  r.notes.forEach(({ tag, address, day }, i) => { const y = 239.5 + i * 13; ctx.beginPath(); ctx.arc(190, y - 3, 2.5, 0, Math.PI * 2); ctx.fillStyle = NOTE_COLORS[tag]; ctx.fill(); text(`d${String(day).padStart(2, '0')} ${tag} ${address}`, 197, y, '#7c8aa0', 9.3); });
  text(refT('code stays here'), 67, 351, '#8b98aa', 12); text(refTf('{count} asm lines kept', { count: r.sourceLines }), 61, 369, P.blue, 11); text('obs', 189, 369, P.cyan, 9); text('inf', 219, 369, '#8b92ee', 9); text('unk', 249, 369, '#6f7d90', 9);

  const cols = 41, rows = 17, size = 6.5, gap = 2.05, mx = 320, my = 219;
  text(refT('one cell = one function'), mx, 212, '#5b6b81', 9);
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
    text(refT(bug ? 'BUG · passed the byte check' : 'TEST THE ORACLE TOO'), 332, 237, color, 10, true);
    text(refT(bug ? 'power check 0.0, original 128.0' : t >= 18.4 ? '1,548 refs · 12 more wrong' : 'now comparing constant bytes'), 332, 252, '#d5dbe7', 10);
    ctx.restore();
  }
  text(r.flagged ? refTf('{count} flagged', { count: r.flagged }) : refT('byte compare'), 320, 379, r.flagged ? P.red : '#71849f', 11);
  text(refTf('exact match {count} / 697', { count: r.matched }), 677, 379, r.flagged ? P.red : P.blue, 12, true, 'right');
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
