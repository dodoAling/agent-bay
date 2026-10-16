// BEGIN GENERATED RESULT VIEW
// Source: result-view.js. Update with npm run build:ui.
// Browser-independent, deliberately small readers for untrusted model/tool text.
// No returned value contains HTML supplied by a tool or a model.
const rvLimits = { raw: 120_000, text: 120_000, code: 40_000, collection: 20, depth: 3, nodes: 260 };
const rvKeywords = new Set(('const let var function return if else switch case break continue while for do try catch finally throw new class extends import export from async await yield true false null undefined void int long float double char bool public private static string using namespace def lambda None True False pass except with as and or not in is SELECT FROM WHERE JOIN INSERT UPDATE DELETE CREATE mov lea call ret push pop cmp test jmp je jne jz jnz add sub xor and or nop ldarg ldloc stloc ldstr ldc br bge mul').split(' '));
const rvOwn = (value, key) => value != null && Object.hasOwn(value, key);
const rvObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function rvEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function rvClip(value, limit) {
  const text = String(value ?? '');
  return { text: text.slice(0, limit), clipped: text.length > limit, length: text.length };
}

function rvNotice(text, warning = false) {
  return `<p class="result-note${warning ? ' warning' : ''}">${rvEscape(text)}</p>`;
}

function rvLimitNotice(length, limit, subject = 'Content') {
  return rvNotice(`${subject} preview truncated: showing ${limit.toLocaleString('en-US')} of ${length.toLocaleString('en-US')} characters. Export session JSON for all retained data.`, true);
}

// Scan tokens before escaping them. Highlighting never reprocesses generated tags,
// so quotes/comments containing tag-shaped text remain plain code.
export function rvHighlight(source, language = '') {
  const text = String(source ?? ''), output = [];
  const assembly = /^(asm|assembly|x86|x64|cil|il|disassembly)$/i.test(language);
  const hashComment = /^(py|python|sh|bash|shell|ps1|powershell|yaml|yml|ruby|rb)$/i.test(language);
  const json = /^json$/i.test(language);
  let index = 0, plain = '';
  const flush = () => { if (plain) { output.push(rvEscape(plain)); plain = ''; } };
  const token = (kind, value) => { flush(); output.push(`<span class="tok-${kind}">${rvEscape(value)}</span>`); };
  while (index < text.length) {
    const char = text[index], next = text[index + 1];
    if (!json && (char === '/' && next === '/' || assembly && char === ';' || hashComment && char === '#')) {
      let end = text.indexOf('\n', index); if (end < 0) end = text.length;
      token('comment', text.slice(index, end)); index = end; continue;
    }
    if (!json && char === '/' && next === '*') {
      const close = text.indexOf('*/', index + 2), end = close < 0 ? text.length : close + 2;
      token('comment', text.slice(index, end)); index = end; continue;
    }
    if (char === '"' || char === "'" || !json && char === '`') {
      let end = index + 1;
      while (end < text.length) { if (text[end] === '\\') { end += 2; continue; } if (text[end++] === char) break; }
      end = Math.min(end, text.length);
      const isKey = json && /^\s*:/.test(text.slice(end));
      token(isKey ? 'key' : 'string', text.slice(index, end)); index = end; continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      let end = index + 1; while (end < text.length && /[\w.$]/.test(text[end])) end++;
      const word = text.slice(index, end);
      if (rvKeywords.has(word) || assembly && rvKeywords.has(word.split('.')[0])) token('keyword', word);
      else if (assembly && /^(?:[re]?(?:ax|bx|cx|dx|sp|bp|si|di)|r\d{1,2}[dwb]?|[xyz]mm\d{1,2}|rip|eip)$/i.test(word)) token('register', word);
      else plain += word;
      index = end; continue;
    }
    if (/\d/.test(char)) {
      const match = text.slice(index).match(/^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
      token('number', match[0]); index += match[0].length; continue;
    }
    plain += char; index++;
  }
  flush(); return output.join('');
}

function rvCode(source, language = 'text') {
  const clipped = rvClip(source, rvLimits.code), label = String(language || 'text').slice(0, 40);
  return `<div class="result-code-block"><div class="code-language"><span>${rvEscape(label)}</span><button type="button" class="result-copy" data-copy-result="code">${clipped.clipped ? 'Copy preview' : 'Copy'}</button></div>${clipped.clipped ? rvLimitNotice(clipped.length, rvLimits.code, 'Code') : ''}<pre class="result-pre result-code"><code>${rvHighlight(clipped.text, label)}</code></pre></div>`;
}

function rvInline(text) {
  const pattern = /`([^`\n]+)`|\[([^\]\n]{1,300})\]\(([^\s)]{1,2048})\)|\*\*([^*\n]+)\*\*/g;
  let output = '', position = 0;
  for (const match of text.matchAll(pattern)) {
    output += rvEscape(text.slice(position, match.index));
    if (match[1] != null) output += `<code>${rvEscape(match[1])}</code>`;
    else if (match[4] != null) output += `<strong>${rvEscape(match[4])}</strong>`;
    else {
      let url;
      try { const parsed = new URL(match[3]); if (/^https?:$/.test(parsed.protocol) && !/[\u0000-\u0020\u007f]/.test(match[3])) url = parsed.href; } catch {}
      output += url ? `<a href="${rvEscape(url)}" target="_blank" rel="noopener noreferrer">${rvEscape(match[2])}</a>` : rvEscape(match[0]);
    }
    position = match.index + match[0].length;
  }
  return output + rvEscape(text.slice(position));
}

export function renderAgentText(source) {
  const clipped = rvClip(source, rvLimits.text), lines = clipped.text.replace(/\r\n?/g, '\n').split('\n');
  const output = []; let paragraph = [], list = [], listType = '', quote = [], fence = null, code = [];
  const flushParagraph = () => { if (paragraph.length) output.push(`<p>${paragraph.map(rvInline).join('<br>')}</p>`); paragraph = []; };
  const flushList = () => { if (list.length) output.push(`<${listType}>${list.map(line => `<li>${rvInline(line)}</li>`).join('')}</${listType}>`); list = []; listType = ''; };
  const flushQuote = () => { if (quote.length) output.push(`<blockquote>${quote.map(rvInline).join('<br>')}</blockquote>`); quote = []; };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };
  for (const line of lines) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) { output.push(rvCode(code.join('\n'), fence.language)); fence = null; code = []; }
      else code.push(line);
      continue;
    }
    const start = line.match(/^ {0,3}(`{3,}|~{3,})([^`~]*)$/);
    if (start) { flush(); fence = { marker: start[1], language: start[2].trim() || 'text' }; continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+)$/);
    if (heading) { flush(); const level = heading[1].length < 3 ? 'h2' : 'h3'; output.push(`<${level}>${rvInline(heading[2])}</${level}>`); continue; }
    const item = line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/);
    if (item) { flushParagraph(); flushQuote(); const type = item[1] ? 'ul' : 'ol'; if (listType && listType !== type) flushList(); listType = type; list.push(item[2]); continue; }
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); continue; }
    flushList(); flushQuote(); paragraph.push(line);
  }
  if (fence) output.push(rvCode(code.join('\n'), fence.language));
  flush();
  return `<div class="agent-markdown">${clipped.clipped ? rvLimitNotice(clipped.length, rvLimits.text, 'Response') : ''}${output.join('') || '<p class="result-note">Waiting for output…</p>'}</div>`;
}

function rvParseJson(text) {
  if (typeof text !== 'string' || text.length > 2_000_000 || !/^[\s]*[\[{]/.test(text)) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

export function rvExtractPayload(result) {
  if (rvObject(result) && rvOwn(result, 'structuredContent') && result.structuredContent != null) return result.structuredContent;
  if (rvObject(result) && Array.isArray(result.content)) {
    for (const item of result.content) { if (item?.type !== 'text') continue; const parsed = rvParseJson(item.text); if (parsed !== undefined) return parsed; }
    const texts = result.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text);
    if (texts.length) return texts.join('\n\n');
  }
  return rvParseJson(result) ?? result;
}

function rvStringify(value) {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'Not provided';
  const seen = new WeakSet();
  try { return JSON.stringify(value, (key, item) => { if (typeof item === 'bigint') return `${item}n`; if (item && typeof item === 'object') { if (seen.has(item)) return '[Repeated or circular reference]'; seen.add(item); } return item; }, 2); }
  catch { return '[This value cannot be serialized]'; }
}

function rvRaw(value, label, detail = '', key = 'raw') {
  const clipped = rvClip(rvStringify(value), rvLimits.raw);
  const pre = `<pre class="result-pre"><code>${rvEscape(clipped.text)}</code></pre>`;
  return `<details class="result-details" data-result-section="${key}"><summary>${rvEscape(label)}</summary><button type="button" class="result-copy" data-copy-result="${key}">${clipped.clipped ? 'Copy preview' : 'Copy'}</button>${detail ? rvNotice(detail) : ''}${clipped.clipped ? rvLimitNotice(clipped.length, rvLimits.raw, label) : ''}${pre}</details>`;
}

function rvBounded(value) {
  let nodes = 0, shortened = false; const seen = new WeakSet();
  function visit(item, depth) {
    if (++nodes > rvLimits.nodes) { shortened = true; return '[Summary node limit; see Raw result]'; }
    if (typeof item === 'string' && item.length > 280) { shortened = true; return `${item.slice(0, 280)}… [String preview; ${item.length} characters total]`; }
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) { shortened = true; return '[Repeated or circular reference]'; } seen.add(item);
    const size = Array.isArray(item) ? item.length : Object.keys(item).length;
    if (depth >= rvLimits.depth) { shortened = true; return `[${Array.isArray(item) ? 'Array' : 'Object'}: ${size} items; see Raw result]`; }
    if (Array.isArray(item)) { const result = item.slice(0, rvLimits.collection).map(child => visit(child, depth + 1)); if (size > rvLimits.collection) { shortened = true; result.push(`[${size - rvLimits.collection} more items; see Raw result]`); } return result; }
    const result = Object.create(null), entries = Object.entries(item);
    for (const [key, child] of entries.slice(0, rvLimits.collection)) result[key] = visit(child, depth + 1);
    if (size > rvLimits.collection) { shortened = true; result['…'] = `[${size - rvLimits.collection} more fields; see Raw result]`; } return result;
  }
  return { value: visit(value, 0), shortened };
}

function rvScalar(value) { return value !== null && ['string', 'number', 'boolean'].includes(typeof value); }
function rvScalarText(value) { return typeof value === 'boolean' ? String(value) : String(value ?? ''); }
function rvDl(entries, className) { return entries.length ? `<dl class="${className}">${entries.map(([key, value]) => `<div><dt>${rvEscape(key)}</dt><dd>${rvEscape(value)}</dd></div>`).join('')}</dl>` : ''; }
function rvUniqueStrings(...values) { return [...new Set(values.flatMap(value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : typeof value === 'string' ? [value] : []))]; }
function rvTextList(title, values, className) {
  if (!values.length) return '';
  return `<section class="result-section ${className}"><h3 class="result-section-title">${rvEscape(title)}</h3><ul>${values.slice(0, rvLimits.collection).map(value => `<li>${rvEscape(rvClip(value, 1200).text)}${value.length > 1200 ? '… [Item preview truncated; see Raw result]' : ''}</li>`).join('')}</ul>${values.length > rvLimits.collection ? rvNotice(`Showing ${rvLimits.collection} of ${values.length} items. See Raw result for the rest.`, true) : ''}</section>`;
}

function rvCoverage(value) {
  if (rvScalar(value)) return rvScalarText(value);
  if (!rvObject(value)) return '';
  const parts = [];
  if (value.status != null || value.state != null) parts.push(rvScalarText(value.status ?? value.state));
  if (value.examined != null || value.total != null) parts.push(`${value.examined ?? '?'} / ${value.total ?? '?'} examined`);
  if (value.exhausted === true) parts.push('Current page exhausted');
  if (value.exhausted === false || value.next_offset != null) parts.push(`More pages available${value.next_offset != null ? ` · offset ${value.next_offset}` : ''}`);
  if (Array.isArray(value.issues) && value.issues.length) parts.push(`${value.issues.length} issues`);
  return parts.join(' · ');
}

function rvEvidenceClass(value) {
  const name = typeof value === 'string' ? value.toLowerCase() : '';
  if (['obs', 'observed'].includes(name)) return ['observed', 'Observed'];
  if (name === 'derived') return ['inferred', 'Derived'];
  if (['inf', 'inferred'].includes(name)) return ['inferred', 'Inferred'];
  return ['unknown', `Unknown · ${!name ? 'not reported' : ['unknown', 'unk'].includes(name) ? 'undetermined' : `unrecognized classification: ${value}`}`];
}

function rvCodeFields(value) {
  if (!rvObject(value)) return [];
  const found = [];
  for (const [key, language] of [['assembly', 'asm'], ['disassembly', 'asm'], ['cil', 'cil'], ['pseudocode', 'text'], ['code', value.language || 'text']]) {
    const data = value[key];
    if (typeof data === 'string' || Array.isArray(data) && data.every(line => typeof line === 'string')) found.push({ key, language, text: Array.isArray(data) ? data.join('\n') : data });
  }
  return found;
}

function rvRecords(page) {
  if (!rvObject(page) || !Array.isArray(page.rows) || !page.rows.length) return '';
  const rows = page.rows.slice(0, rvLimits.collection);
  if (!rows.every(rvObject)) return '';
  const columns = [...new Set(rows.slice(0, 5).flatMap(row => Object.entries(row).filter(([, value]) => rvScalar(value)).map(([key]) => key)))].slice(0, 6);
  if (!columns.length) return '';
  const table = `<div class="result-table-wrap"><table class="result-table"><thead><tr>${columns.map(key => `<th>${rvEscape(key)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(key => { const value = rvScalar(row[key]) ? rvScalarText(row[key]) : ''; const clipped = rvClip(value, 160); return `<td>${rvEscape(clipped.text)}${clipped.clipped ? '… [preview]' : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<section class="result-section"><h3 class="result-section-title">${rvEscape(page.collection || 'Returned records')}</h3>${table}${page.rows.length > rows.length ? rvNotice(`Showing ${rows.length} of ${page.rows.length} records. See Raw result for the rest.`) : ''}</section>`;
}

export function renderToolResult(call = {}, options = {}) {
  const end = call.end, raw = end?.result, payload = rvExtractPayload(raw);
  const envelope = rvObject(payload) ? payload : {}, isEvidence = rvOwn(envelope, 'normalized_result');
  const normalized = isEvidence ? envelope.normalized_result : payload;
  const data = rvObject(normalized) ? normalized : {};
  const summary = rvObject(data.summary) ? data.summary : data;
  const pending = call.pending === true || !end;
  const error = !pending && (end?.ok === false || raw?.isError === true);
  const status = pending ? ['running', 'Running'] : error ? ['error', 'Failed'] : end?.ok === true ? ['success', 'Success'] : ['unknown', 'Status not reported'];
  const duration = Number.isFinite(end?.durationMs) && end.durationMs >= 0 ? `${end.durationMs.toLocaleString('en-US')} ms` : 'Duration not reported';
  const header = `<div class="result-title">${rvEscape(call.name || end?.name || 'Unnamed tool')}</div><div class="result-summary"><span class="result-status ${status[0]}">${status[1]}</span><span class="result-duration">${pending ? 'Waiting for tool result' : duration}</span>${call.source || end?.source ? `<span class="result-source">${rvEscape(call.source || end.source)}</span>` : ''}</div>`;
  const sections = [header];
  if (pending) sections.push(rvNotice('The tool is running. Actual results will appear when its end event arrives.'));
  else if (raw === undefined) sections.push(rvNotice('The end event did not include result content.', true));
  else {
    const preview = raw?.truncated === true ? raw : envelope.truncated === true ? envelope : data.truncated === true ? data : null;
    if (preview) sections.push(rvNotice(`Upstream marked truncated: only a partial preview was received${Number.isFinite(preview.totalCharacters) ? `, ${preview.totalCharacters.toLocaleString('en-US')} original characters` : ''}; this is not a complete result.`, true));
    if (error) {
      const message = typeof envelope.error === 'string' ? envelope.error : typeof envelope.error?.message === 'string' ? envelope.error.message : typeof envelope.message === 'string' ? envelope.message : typeof payload === 'string' ? payload : '';
      if (message) sections.push(`<section class="result-section"><h3 class="result-section-title">Error details</h3>${renderAgentText(message)}</section>`);
    }
    const provider = envelope.provider ?? data.provider;
    const meta = [];
    if (envelope.operation || data.operation) meta.push(['Operation', envelope.operation || data.operation]);
    if (provider) meta.push(['Provider', rvObject(provider) ? provider.name || provider.id || 'Unnamed provider' : rvScalarText(provider)]);
    const subject = envelope.subject || data.artifact || summary.artifact;
    if (subject?.name || subject?.path || subject?.local_path) meta.push(['Target', subject.name || subject.path || subject.local_path]);
    const sha = envelope.subject?.digest?.sha256 || data.artifact?.sha256 || summary.artifact?.sha256;
    if (sha) meta.push(['SHA-256', sha]);
    if (envelope.evidence_id) meta.push(['Evidence', envelope.evidence_id]);
    const coverage = rvCoverage(data.coverage || summary.coverage || envelope.relationship_coverage);
    if (coverage) meta.push(['Coverage', coverage]);
    const [evidenceClass, evidenceLabel] = rvEvidenceClass(envelope.confidence || data.confidence || (typeof data.classification === 'string' ? data.classification : ''));
    sections.push(`<div class="result-evidence ${evidenceClass}"><span>${rvEscape(evidenceLabel)}</span>${envelope.authority ? `<span>${rvEscape(envelope.authority)}</span>` : ''}</div>`);
    const facts = [];
    if (rvObject(data.page) && Array.isArray(data.page.rows)) facts.push([`Current page · ${data.page.collection || 'rows'}`, `${data.page.rows.length} items`]);
    const counts = summary.metadata?.table_row_counts || data.metadata?.table_row_counts;
    if (rvObject(counts)) for (const [key, count] of Object.entries(counts).slice(0, rvLimits.collection)) if (typeof count === 'number') facts.push([`metadata · ${key}`, count]);
    const explicitCounts = summary.reported_counts || data.reported_counts;
    if (rvObject(explicitCounts)) for (const [key, count] of Object.entries(explicitCounts).slice(0, rvLimits.collection)) if (rvScalar(count)) facts.push([key, rvScalarText(count)]);
    for (const [key, value] of Object.entries(summary)) {
      if (facts.length >= 24) break;
      if (rvScalar(value) && !['code', 'pseudocode', 'assembly', 'disassembly', 'cil', 'preview', 'confidence', 'operation', 'provider'].includes(key) && String(value).length <= 180) facts.push([key, rvScalarText(value)]);
    }
    if (facts.length) sections.push(`<section class="result-section"><h3 class="result-section-title">Summary</h3>${rvDl(facts, 'result-facts')}</section>`);
    sections.push(rvDl(meta, 'result-meta'));
    const limitations = rvUniqueStrings(envelope.limitations, data.limitations, summary !== data ? summary.limitations : []);
    const unknowns = rvUniqueStrings(envelope.unknowns, data.unknowns, summary !== data ? summary.unknowns : []);
    sections.push(rvTextList('Limitations', limitations, 'result-limitations'));
    sections.push(rvTextList('Unknowns', unknowns, 'result-unknowns'));
    const codeFields = rvCodeFields(data);
    for (const code of codeFields) sections.push(`<section class="result-section"><h3 class="result-section-title">${rvEscape(code.key)}</h3>${rvCode(code.text, code.language)}</section>`);
    sections.push(rvRecords(data.page));
    if (preview && typeof preview.preview === 'string') sections.push(`<section class="result-section"><h3 class="result-section-title">Received truncated preview</h3>${rvCode(preview.preview, 'text')}</section>`);
    else if (typeof normalized === 'string' && !error) sections.push(renderAgentText(normalized));
    else if (normalized !== undefined && !(error && Object.keys(data).every(key => ['error', 'message', 'isError'].includes(key)))) {
      const overview = rvObject(normalized) ? Object.fromEntries(Object.entries(normalized).filter(([key]) => !['limitations', 'unknowns', ...codeFields.map(code => code.key)].includes(key))) : normalized;
      const bounded = rvBounded(overview);
      sections.push(`<details class="result-details" data-result-section="normalized"><summary>${isEvidence ? 'Normalized result · Structured details' : 'Structured details'}</summary>${bounded.shortened ? rvNotice('Summaries show up to 3 levels and 20 items per collection. Omitted details do not indicate missing upstream data. See Raw result for the rest.') : ''}${rvCode(rvStringify(bounded.value), 'json')}</details>`);
    }
    sections.push(rvRaw(raw, 'Raw result', 'The format returned by the tool is preserved. Structured content and content.text may encode the same data.'));
  }
  const hasInput = call.startAvailable !== false && rvOwn(call, 'args');
  sections.push(hasInput ? rvRaw(call.args, 'Input arguments', '', 'input') : `<details class="result-details" data-result-section="input"><summary>Input arguments unavailable</summary>${rvNotice(call.startAvailable === false ? 'The start event is outside the retained window; input arguments cannot be recovered.' : 'The start event did not provide input arguments.')}</details>`);
  return `<div class="tool-result" data-result-status="${status[0]}">${sections.join('')}</div>`;
}

// END GENERATED RESULT VIEW

import { DemoPlayer, SCENARIOS } from './demo-player.js';
import { FactoryView } from './factory-view.js';
import { referenceState, referenceSparks, referenceFeed } from './demo-scenarios.js';
import { installThemedSelects, refreshThemedSelects } from './themed-select.js';
const $ = selector => document.querySelector(selector);
const exportOnly = new URLSearchParams(location.search).get('export') === '1';
const desktopInvoke = !exportOnly && window.__TAURI__?.core?.invoke?.bind(window.__TAURI__.core);
const desktopWindow = !exportOnly && window.__TAURI__?.window?.getCurrentWindow?.();
installThemedSelects(document);
let pickingTarget = false, exporting = false;
for (const button of document.querySelectorAll('.native-browse')) button.hidden = !desktopInvoke;
document.body.classList.toggle('desktop', Boolean(desktopInvoke));
function applyWindowStyle(value) {
  const style = value === 'macos' ? 'macos' : 'windows';
  document.body.dataset.windowStyle = style;
  for (const button of document.querySelectorAll('[data-window-style-choice]')) button.setAttribute('aria-pressed', String(button.dataset.windowStyleChoice === style));
}
for (const button of document.querySelectorAll('[data-window-style-choice]')) button.disabled = !desktopWindow;
if (!desktopWindow) $('#window-style-note').textContent = 'Window buttons are available in the desktop app.';
if (desktopWindow) {
  $('#desktop-window-controls').hidden = false;
  let style = /mac/i.test(navigator.userAgentData?.platform || navigator.platform) ? 'macos' : 'windows';
  try { style = localStorage.getItem('agent-bay.window-style') || style; } catch {}
  applyWindowStyle(style);
  let windowStyleEdited = false;
  void desktopInvoke('desktop_preferences').then(preferences => {
    if (!windowStyleEdited && ['windows', 'macos'].includes(preferences.windowStyle)) applyWindowStyle(preferences.windowStyle);
  }).catch(() => {});
  const changeWindowStyle = style => {
    windowStyleEdited = true;
    applyWindowStyle(style);
    try { localStorage.setItem('agent-bay.window-style', style); } catch {}
    void desktopInvoke('set_window_style', { style }).catch(error => toast(`Could not save window style: ${error.message || error}`, true));
  };
  for (const button of document.querySelectorAll('[data-window-style-choice]')) button.onclick = () => changeWindowStyle(button.dataset.windowStyleChoice);
  const refreshWindowState = async () => {
    const maximized = await desktopWindow.isMaximized();
    document.body.classList.toggle('desktop-maximized', maximized);
    const label = maximized ? 'Restore window' : 'Maximize window';
    $('#window-maximize').title = label;
    $('#window-maximize').setAttribute('aria-label', label);
  };
  const windowAction = async action => {
    try { await desktopWindow[action](); if (action === 'toggleMaximize') await refreshWindowState(); }
    catch (error) { toast(`Window action failed: ${error.message || error}`, true); }
  };
  $('#window-minimize').onclick = () => windowAction('minimize');
  $('#window-maximize').onclick = () => windowAction('toggleMaximize');
  $('#window-close').onclick = () => windowAction('close');
  const dragSurface = event => !event.target.closest('button,input,select,a');
  $('.titlebar').addEventListener('mousedown', event => {
    if (event.button === 0 && dragSurface(event)) void windowAction(event.detail === 2 ? 'toggleMaximize' : 'startDragging');
  });
  desktopWindow.onResized?.(() => { void refreshWindowState().catch(() => {}); }).catch(() => {});
  void refreshWindowState().catch(() => {});
}
const factory = new FactoryView($('#factory-canvas'));
const liveState = { runs: [], events: [], sequence: 0, eventLimit: 5000, connections: [], model: null, selected: null, selectedCall: null, filter: '', setup: null, follow: true };
let state = liveState, demoFrame = null;
const stages = ['observe', 'reason', 'execute', 'verify'];
const stageLabels = { observe: 'Read context', reason: 'Model reasoning', execute: 'Tool execution', verify: 'Verify results' };
let renderQueued = false, toastTimer, bridge, lastPreviewRender = 0;
let outputRenderKey = '', outputRenderContext = '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const clock = at => new Date(at).toLocaleTimeString('en-GB', { hour12: false });
const short = (value, length = 70) => { const text = typeof value === 'string' ? value : JSON.stringify(value ?? {}); return text.length > length ? text.slice(0, length) + '…' : text; };

async function api(path, data) {
  const response = await fetch('/api' + path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.className = 'toast visible' + (error ? ' error' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4500); }
function dialogStatus(message = '', error = false) { $('#dialog-status').textContent = message; $('#dialog-status').className = 'dialog-status' + (error ? ' error' : ''); }
function queueRender() { if (!renderQueued) { renderQueued = true; setTimeout(() => { renderQueued = false; render(); }, 75); } }

function snapshot(data) {
  Object.assign(liveState, { runs: data.runs, events: data.events, sequence: data.sequence || 0, eventLimit: data.retention?.eventLimit || 5000, connections: data.connections, model: data.model });
  if (!liveState.selected || !liveState.runs.some(r => r.id === liveState.selected)) liveState.selected = liveState.runs.at(-1)?.id || null;
  if (!player.active) state = liveState;
  renderConnections(); queueRender();
}
bridge = exportOnly ? { readyState: EventSource.OPEN, addEventListener() {} } : new EventSource('/api/stream');
bridge.addEventListener('snapshot', e => snapshot(JSON.parse(e.data)));
bridge.addEventListener('update', e => {
  const event = JSON.parse(e.data);
  if (event.id <= liveState.sequence) return;
  liveState.sequence = event.id;
  liveState.events.push(event);
  if (liveState.events.length > liveState.eventLimit) liveState.events.shift();
  if (event.type === 'run.start') {
    liveState.runs.push(event.run || { id: event.runId, title: event.title, source: event.source, mode: event.source === 'demo' ? 'demo' : 'external', startedAt: event.at, status: 'running', stage: 'observe' });
    if (liveState.follow) { liveState.selected = event.runId; liveState.selectedCall = null; }
  }
  const run = liveState.runs.find(r => r.id === event.runId);
  if (run && event.runSummary) run.summary = { ...event.runSummary };
  if (run && event.type === 'stage') run.stage = event.stage;
  if (run && event.type === 'run.end') { run.status = event.status; run.endedAt = event.at; }
  queueRender();
});
bridge.addEventListener('connections', e => { Object.assign(liveState, JSON.parse(e.data)); renderConnections(); queueRender(); });
bridge.onopen = () => { if (!player.active) { $('#stream-dot').className = 'dot'; $('#stream-label').textContent = 'LIVE BRIDGE'; queueRender(); } };
bridge.onerror = () => { if (!player.active) { $('#stream-dot').className = 'dot off'; $('#stream-label').textContent = 'RECONNECTING'; queueRender(); } };

function renderConnections() {
  if (player.active) {
    $('#connection-chips').innerHTML = demoFrame.scene === 'cleanroom' ? '<span class="reference-engine active">ghidra</span><span class="reference-engine">hopper</span><span class="reference-engine">ida</span>' : `<span class="simulated">MODEL · DEMO</span><span class="simulated">${esc(SCENARIOS[demoFrame.scene].name)} · DEMO</span>`;
    $('#mcp-count').textContent = 'simulated tools · local';
    return;
  }
  const connected = state.connections.filter(s => s.status === 'connected');
  $('#connection-chips').innerHTML = [state.model ? `<span class="connected">${esc(state.model.protocol === 'anthropic' ? 'Messages' : 'Chat API')}</span>` : '<span>API offline</span>', ...connected.map(s => `<span class="connected">${esc(s.name)}</span>`), ...(!connected.length ? ['<span>MCP offline</span>'] : [])].join('');
  $('#mcp-count').textContent = `${connected.length} MCP SERVERS`;
  if (state.model) {
    $('#base-url').value = state.model.baseUrl;
    $('#model-id').value = state.model.model;
    $('#protocol').value = state.model.protocol;
    $('#api-key').placeholder = state.model.hasKey ? 'Configured; re-enter to save' : 'Optional for local APIs';
  }
  $('#clear-model').disabled = !state.model;
  renderToolLibrary();
}
function callsFor(events) {
  const calls = new Map();
  for (const event of events) {
    if (event.duplicate) continue;
    const callId = event.callId != null && event.callId !== '' ? String(event.callId) : undefined;
    const key = callId ?? `event-${event.id}`;
    if (event.type === 'tool.start' && !calls.has(key)) calls.set(key, { ...event, callId, pending: true, startAvailable: true });
    if (event.type === 'tool.end') {
      const previous = calls.get(key);
      if (!previous?.end) calls.set(key, { ...(previous || event), callId, pending: false, startAvailable: previous?.startAvailable || false, end: event });
    }
  }
  return [...calls.values()];
}
// Preview playback animates the header chef's sparks with the measured loop; live views keep the static sprite.
let chefSparkFrame;
function renderChefSparks(frame) {
  const group = $('.brand-icon g[data-part="spark"]');
  if (!group || frame === chefSparkFrame) return;
  group.dataset.static ??= group.innerHTML;
  chefSparkFrame = frame;
  group.innerHTML = frame === null ? group.dataset.static : referenceSparks(frame).map(({ x, y, dim }) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${dim ? '#aaa35c' : '#e6d477'}"/>`).join('');
}
// The clean-room preview replays the measured rail feed: each call slides the list down one row.
function renderReferenceFeed(seconds) {
  const feed = referenceFeed(seconds);
  $('#tool-feed').innerHTML = `<div class="reference-feed" style="transform:translateY(${((feed.slide - 1) * 44).toFixed(2)}px)">${feed.calls.map((c, i) => {
    const meta = c.tag && c.tag !== 'bad' ? `<i class="evidence-dot ${c.tag}"></i><span>${esc(c.result)} · ${c.tag}</span>` : `<span>${esc(c.result)}</span>`;
    return `<div class="tool-item${i === 0 && feed.fresh ? ' fresh' : ''}${c.tag === 'bad' ? ' failed' : ''}"><div class="tool-title"><span class="tool-prefix">rea.</span><b>${esc(c.tool)}</b><span class="tool-inline-args">${esc(c.arg)}</span></div><div class="tool-meta">${meta}</div></div>`;
  }).join('')}</div>`;
}
function render() {
  const run = state.runs.find(r => r.id === state.selected);
  const events = state.events.filter(e => e.runId === state.selected);
  const calls = callsFor(events);
  const reference = player.active && demoFrame.scene === 'cleanroom' ? referenceState(demoFrame.elapsed, demoFrame.duration) : null;
  document.body.classList.toggle('reference-scene', !!reference);
  document.body.classList.toggle('reference-playable', !!reference?.runtime);
  renderChefSparks(player.active ? Math.floor(demoFrame.elapsed * 30 / 1000 + 1e-7) : null);
  $('#brand-name').textContent = reference ? 'Agent Bay Studio' : 'Agent Bay';
  $('.titlebar > span').textContent = reference ? 'Agent Bay × REA — clean room · oracle on' : 'agent-bay // local control plane';
  $('.flow-panel .panel-heading .section-label').textContent = reference ? 'ONE BINARY · TWO ROOMS' : 'ONE WORKFLOW · TWO ROOMS';
  $('.rail-session-header > span').textContent = reference ? 'REA · MCP SESSION' : 'MCP · SESSION';
  // A live run's counters cover its lifetime; calls/events below are only the
  // bounded detail window. Preview frames always derive their own time slice.
  const lifetimeSummary = !player.active ? run?.summary : null;
  const callCount = lifetimeSummary?.calls ?? calls.length;
  const success = lifetimeSummary?.success ?? calls.filter(c => c.end?.ok === true).length;
  const checks = events.filter(e => e.type === 'check');
  const checksCount = lifetimeSummary?.checks ?? checks.length;
  const checksPassed = lifetimeSummary?.checksPassed ?? checks.filter(c => c.status === 'passed').length;
  const finished = lifetimeSummary ? callCount - lifetimeSummary.pending : calls.filter(c => !c.pending).length;
  const failures = lifetimeSummary?.errors ?? calls.filter(c => c.end?.ok === false).length;
  const total = player.active ? SCENARIOS[demoFrame.scene].count : callCount;
  const pending = player.active ? total - finished : lifetimeSummary?.pending ?? calls.filter(c => c.pending).length;
  const eventTotal = lifetimeSummary?.events ?? events.length;
  const trimmed = eventTotal > events.length;
  const windowNote = trimmed ? `${eventTotal} total events; ${events.length} details retained for this session. The global detail window keeps the latest ${liveState.eventLimit} events. Lifetime totals remain intact.` : '';
  const progress = player.active ? demoFrame.elapsed / demoFrame.duration : total ? finished / total : 0;
  const step = Math.min(12, Math.floor(progress * 12) + 1);
  const usages = events.filter(e => e.type === 'model.end').map(e => e.usage || {});
  let tokens = 0, reported = false;
  for (const usage of usages) { if (usage.total_tokens != null) { tokens += Number(usage.total_tokens); reported = true; } else if (usage.input_tokens != null || usage.output_tokens != null || usage.prompt_tokens != null || usage.completion_tokens != null) { tokens += Number(usage.input_tokens || usage.prompt_tokens || 0) + Number(usage.output_tokens || usage.completion_tokens || 0); reported = true; } }
  if (lifetimeSummary) { tokens = lifetimeSummary.tokens; reported = lifetimeSummary.usageReported; }
  $('#metric-calls').textContent = pad(callCount);
  $('#metric-success').textContent = pad(success);
  $('#metric-pending').textContent = pad(pending);
  $('#metric-errors').textContent = pad(failures);
  $('#metric-calls-label').textContent = reference ? 'functions read' : 'tool calls';
  $('#metric-success-label').textContent = reference ? 'exact match' : 'successful';
  $('#metric-errors-label').textContent = reference ? 'code copied' : 'failed calls';
  $('#metric-pending').style.color = reference ? reference.openAlert ? '#fa3f5b' : '#7d8596' : '';
  $('#signal-tools').style.color = reference ? reference.constants ? '#fa3f5b' : '#249eff' : '';
  $('#signal-tools-bar').style.background = reference ? reference.constants ? '#fa3f5b' : '#249eff' : '';
  $('#progress-success').style.background = reference?.flagged ? 'linear-gradient(to right, #43cef0 calc(100% - 4px), #fa3f5b calc(100% - 4px))' : '';
  if (reference) {
    $('#metric-calls').textContent = reference.read; $('#metric-success').textContent = reference.matched;
    $('#metric-pending').textContent = reference.open; $('#metric-errors').textContent = '0';
  }
  $('#metric-checks').textContent = checksCount ? `${checksPassed}/${checksCount}` : '—';
  $('#metric-tokens').textContent = reported ? tokens.toLocaleString() : '—';
  $('#model-label').textContent = run?.model || state.model?.model || 'Waiting for an agent';
  $('#mode-label').textContent = player.active ? `step ${pad(step)} / 12 · DEMO` : run?.mode === 'demo' ? 'DEMO / SIMULATED' : run?.mode === 'external' ? 'EXTERNAL AGENT' : 'LOCAL WORKSPACE';
  if (reference) { $('#model-label').textContent = reference.runtime ? 'playable' : 'clean room'; $('#mode-label').textContent = `day ${pad(reference.day)} / 12`; }
  $('.brand-caption').textContent = reference ? 'REA reads · SPEC.md is the wall · oracle decides' : 'context → tools → results · every signal leaves a trace';
  const status = $('#run-status');
  status.className = 'badge ' + (run?.mode === 'demo' ? 'demo' : run?.status || '');
  status.textContent = run?.mode === 'demo' ? 'DEMO DATA' : ({ running: 'RUNNING', completed: 'COMPLETED', failed: 'FAILED', cancelled: 'STOPPED' }[run?.status] || 'STANDBY');
  const oldValue = $('#run-select').value;
  const options = [...state.runs].reverse().map(r => `<option value="${esc(r.id)}">${r.mode === 'demo' ? '[DEMO] ' : ''}${esc(r.title)}</option>`).join('');
  const optionKey = state.runs.map(r => r.id).join('|');
  if ($('#run-select').dataset.optionKey !== optionKey) { $('#run-select').innerHTML = options || '<option value="">New session</option>'; $('#run-select').dataset.optionKey = optionKey; }
  $('#run-select').value = state.selected || oldValue;
  const target = run?.target || '';
  $('#target-name').textContent = target ? target.split(/[\\/]/).filter(Boolean).at(-1) : run ? 'Agent task' : 'READY';
  $('#target-name').title = target || run?.title || '';
  $('#target-path').title = target || run?.title || '';
  $('#target-path').textContent = player.active ? demoFrame.scene === 'reverse' ? 'x64 · PE32+ · simulated session' : 'local workspace · simulated session' : target || run?.title || 'Connect models and tools, or an existing agent';
  if (reference) $('#target-path').textContent = 'x86 · PE32 · simulated locally';
  $('#target-mode').textContent = run?.mode === 'demo' ? 'DEMO' : run?.mode === 'external' ? 'EXTERNAL' : 'LOCAL';
  $('#flow-source').textContent = run?.mode === 'demo' ? 'results · DEMO' : run ? 'live results' : 'waiting for signals';
  if (reference) $('#flow-source').textContent = reference.constants ? 'oracle bytes+const' : 'oracle bytes';
  $('#flow-source').classList.toggle('reference-oracle', !!reference);
  $('#factory-source').textContent = player.active ? `${SCENARIOS[demoFrame.scene].source.split(' / ')[0]} local` : state.connections.some(s => s.status === 'connected') ? 'MCP local' : 'MCP offline';
  $('#flow-scene').classList.toggle('running', run?.status === 'running');
  const stage = run?.stage || 'observe', phase = stages.indexOf(stage);
  document.querySelectorAll('[data-room-stage]').forEach(chip => { chip.classList.toggle('active', !!run && run.status === 'running' && (chip.dataset.roomStage === stage || player.active && ['observe', 'reason', 'execute'].includes(chip.dataset.roomStage) && calls.length > 0 && Math.floor(demoFrame.elapsed / 800) % 3 !== 0)); });
  document.querySelectorAll('.node').forEach(node => { node.classList.toggle('active', !!run && node.dataset.stage === stage); node.classList.toggle('done', !!run && stages.indexOf(node.dataset.stage) < phase); });
  const phaseEvent = events.findLast(e => e.type === 'stage');
  $('#phase-message').textContent = run ? (run.status === 'running' ? phaseEvent?.message || stageLabels[stage] : events.findLast(e => e.type === 'run.end')?.message || { completed: 'COMPLETED', failed: 'FAILED', cancelled: 'STOPPED' }[run.status]) : 'Connect a model or send events from an existing agent.';
  $('#event-count').textContent = `${eventTotal} EVENTS${trimmed ? ` · ${events.length} retained` : ''}`;
  $('#event-count').title = windowNote || 'Lifetime event count. The log shows the latest 300 non-delta events.';
  $('#footer-state').textContent = run ? `${run.mode === 'demo' ? 'SIMULATED' : 'LIVE EVENTS'} · ${eventTotal} events${trimmed ? ` · ${events.length} details retained` : ''} · ${run.status === 'running' ? 'RUNNING' : 'ENDED'}` : 'LIVE EVENTS · No active task';
  $('#footer-state').title = windowNote;
  $('#export-btn').disabled = !run || exporting;
  const activeAgent = state.runs.some(r => r.source === 'agent' && r.status === 'running');
  $('#stop-btn').disabled = player.active || !activeAgent;
  $('#run-btn').disabled = player.active || activeAgent;
  $('#settings-btn').disabled = player.active;
  $('#tools-btn').disabled = player.active;
  $('#run-select').disabled = player.active;
  for (const button of document.querySelectorAll('.native-browse')) button.disabled = player.active || activeAgent || pickingTarget;
  $('#checks-list').innerHTML = checks.length ? checks.map(e => `<div class="check-row ${esc(e.status)}"><span>${esc(e.name || 'Check')}</span><span>${{ passed: 'PASS', failed: 'FAIL', unknown: 'UNKNOWN' }[e.status]}</span></div>`).join('') : `<div class="unreported">${checksCount ? 'Earlier check details are outside the retention window' : 'No checks reported'}<span>—</span></div>`;
  const feedCalls = [...calls].reverse();
  $('#tool-feed').title = windowNote || 'Latest 8 retained tool calls';
  if (reference) renderReferenceFeed(reference.seconds);
  else $('#tool-feed').innerHTML = (trimmed ? '<p class="field-note">Counts cover the session lifetime. Only retained call details appear below.</p>' : '') + (calls.length ? feedCalls.slice(0, 8).map(c => {
    const kind = c.end?.result?.classification || (c.end?.ok === false ? 'unk' : 'obs');
    const arg = c.args?.procedure || c.args?.path || c.args?.topic || '';
    const meta = c.pending ? player.active ? 'running' : `Running · ${Math.max(0, Math.floor((Date.now() - c.at) / 1000))}s` : player.active && c.end?.result?.lines ? `${c.end.result.lines} lines · ${kind}` : `${c.end?.durationMs ?? '—'} ms · ${c.end?.ok ? 'success' : 'failed'}`;
    return `<button class="tool-item ${state.selectedCall === c.callId ? 'selected' : ''} ${c.end?.ok === false ? 'failed' : ''}" data-call="${esc(c.callId || '')}" title="${esc(`${c.source || 'tool'} / ${c.name}${arg ? '\n' + arg : ''}`)}"><div class="tool-title"><span class="tool-prefix">${esc((c.source || 'tool').split(' / ')[0].toLowerCase().slice(0, 10))}.</span><b>${esc(c.name)}</b><span class="tool-inline-args">${esc(short(arg, 28))}</span></div><div class="tool-meta"><i class="evidence-dot ${esc(kind)}"></i><span>${esc(meta)}</span></div></button>`;
  }).join('') : `<div class="empty-state"><span class="empty-icon">⌘</span><p>${callCount ? `${callCount} tool ${callCount === 1 ? 'call' : 'calls'} recorded` : 'Waiting for the first tool call'}</p><small>${callCount ? 'Earlier tool details are outside the retention window' : 'Calls appear here as live events arrive'}</small></div>`);
  const lastCalls = calls.slice(-128);
  $('#activity-map').innerHTML = Array.from({ length: 128 }, (_, i) => { const c = lastCalls[i]; return `<i class="cell ${c ? c.pending ? 'running' : c.end?.ok ? 'success' : 'failed' : ''}" title="${esc(c ? `${c.name} / ${c.pending ? 'Running' : c.end?.ok ? 'Success' : 'Failed'}` : 'Waiting for a call')}"></i>`; }).join('');
  renderOutput(events, calls);
  renderTimeline(events, calls);
  $('#progress-called').style.width = `${total ? callCount / total * 100 : 0}%`;
  $('#progress-success').style.width = `${total ? success / total * 100 : 0}%`;
  $('#progress-called-count').textContent = `${callCount}/${total || '—'}`;
  $('#progress-success-count').textContent = `${success}/${total || '—'}`;
  $('#factory-open').textContent = `still open ${pending} · ${failures ? `${failures} flagged for review` : 'keep every result traceable'}`;
  $('#factory-step').textContent = player.active ? `step ${pad(step)}` : run?.status === 'completed' ? 'done' : stage;
  $('#factory-progress-note').textContent = player.active ? 'same checks, from zero · DEMO' : `${eventTotal} actual events${trimmed ? ` · ${events.length} retained` : ''}`;
  $('#signal-tools').textContent = `${success}/${total || '—'}`;
  $('#signal-tools-bar').style.width = `${total ? success / total * 100 : 0}%`;
  $('#signal-checks-bar').style.width = `${checksCount ? checksPassed / checksCount * 100 : 0}%`;
  $('#signal-runtime').textContent = run?.status === 'completed' ? 'complete' : run?.status === 'failed' ? 'failed' : run?.status === 'running' ? 'running' : 'waiting';
  $('#signal-runtime-bar').style.width = `${run?.status === 'completed' ? 100 : run?.status === 'running' ? Math.max(2, progress * 100) : 0}%`;
  $('#rail-signals-label').textContent = reference ? '3 ORACLES' : '3 SIGNALS';
  $('#signal-tools-label').textContent = reference ? 'byte' : 'tools';
  $('#signal-tools-note').textContent = reference ? reference.constants ? 'instructions + constant bytes' : 'compiled bytes vs original' : 'successful tool calls';
  $('#signal-checks-label').textContent = reference ? 'planted' : 'checks';
  $('#signal-checks-note').textContent = reference ? 'wrong const · swapped branch · off-by-1' : 'reported verification results';
  $('#signal-runtime-note').textContent = reference ? 'build it, play it, watch it' : 'run it, inspect it, verify it';
  $('#factory-progress-title').textContent = reference ? 'THE FACTORY · SECOND GAME' : 'THE FACTORY · AGENT WORKFLOW';
  $('#progress-called-label').textContent = reference ? 'REA read' : 'tools called';
  $('#progress-success-label').textContent = reference ? 'exact match' : 'successful';
  $('#room-a-title').textContent = reference ? 'ROOM A · REA reads, writes spec' : 'ROOM A · read context, plan the work';
  $('#room-b-title').textContent = reference ? 'ROOM B · spec only, then oracle' : 'ROOM B · use tools, verify results';
  const roomLabels = reference ? ['load binary', 'pseudocode', 'tag obs/inf/unk', 'write SPEC.md', 'commit NOTES.md', 'read SPEC.md', 'build fn', 'run oracle', '3 planted fail', 'check const bytes'] : ['load target', 'read context', 'tag obs/inf/unk', 'write PLAN.md', 'commit NOTES.md', 'read PLAN.md', 'call tools', 'run checks', 'retry failures', 'inspect results'];
  document.querySelectorAll('.room-chips span').forEach((chip, i) => {
    chip.textContent = roomLabels[i];
    chip.hidden = !!reference && i === 9 && !reference.constants;
    chip.style.setProperty('--pulse', reference ? i < 5 ? reference.roomPulseA.toFixed(3) : i < 8 ? reference.roomPulseB.toFixed(3) : 0 : '');
    if (reference) chip.classList.toggle('active', i === 8 ? reference.plantedChip : i === 9);
  });
  if (reference) {
    $('#progress-called').style.width = `${reference.read / 697 * 100}%`;
    $('#progress-success').style.width = `${reference.matched / 697 * 100}%`;
    $('#progress-called-count').textContent = `${reference.read}/697`; $('#progress-success-count').textContent = `${reference.matched}/697`;
    $('#factory-open').textContent = `still open ${reference.open}`; $('#factory-step').textContent = `day ${pad(reference.day)}`;
    $('#factory-progress-note').textContent = 'same checks, from zero';
    $('#signal-tools').textContent = `${reference.matched}/697`; $('#signal-tools-bar').style.width = `${reference.matched / 697 * 100}%`;
    $('#metric-checks').textContent = `${reference.rejected}/3 caught`; $('#signal-checks-bar').style.width = `${reference.rejected / 3 * 100}%`;
    $('#signal-runtime').textContent = reference.runtime ? 'playable' : 'waiting'; $('#signal-runtime-bar').style.width = `${Math.max(.02, reference.runtimeProgress) * 100}%`;
  }
  const result = calls.findLast(c => c.end?.ok)?.end?.result;
  const readerLines = result?.assembly || (result?.pseudocode ? result.pseudocode.split('\n') : result?.content?.find(c => c.type === 'text')?.text?.split('\n').slice(0, 12)) || ['waiting for tool data', 'no target loaded'];
  const modelBoundary = events.findLast(e => e.type === 'model.start' || e.type === 'model.end');
  const modelOpen = modelBoundary ? modelBoundary.type === 'model.start' : run?.status === 'running' && events.some(e => e.type === 'model.delta');
  const bridgeConnected = bridge.readyState === EventSource.OPEN;
  const visualState = run && ['failed', 'completed', 'cancelled'].includes(run.status) ? run.status : !bridgeConnected ? 'disconnected' : !run ? 'idle' : pending > 0 ? 'working' : 'waiting';
  const stateLabels = { idle: 'READY', working: 'RUNNING', waiting: modelOpen ? 'RESPONDING' : 'WAITING', failed: 'FAILED', completed: 'COMPLETED', cancelled: 'STOPPED', disconnected: 'OFFLINE' };
  const stateDetail = visualState === 'working' ? `${pending} ${pending === 1 ? 'tool' : 'tools'} in flight · ${calls.findLast(c => c.pending)?.name || 'Waiting for call details'}` : visualState === 'waiting' ? modelOpen ? 'Receiving model output. No tools running.' : 'Waiting for the next agent event.' : visualState === 'disconnected' ? 'Reconnecting; showing the last received state.' : visualState === 'completed' && pending > 0 ? `Ended with ${pending} missing tool ${pending === 1 ? 'result' : 'results'}. See event log.` : visualState === 'idle' ? 'Connect a model or send agent events.' : events.findLast(e => e.type === 'run.end')?.message || stateLabels[visualState];
  if (!player.active) {
    $('.window').dataset.workState = visualState;
    if ($('#work-state')) { $('#work-state').dataset.state = visualState; $('#work-state').textContent = stateLabels[visualState]; }
    $('#phase-message').textContent = stateDetail; $('#phase-message').title = stateDetail;
    $('#flow-scene').classList.toggle('running', visualState === 'working');
  }
  factory.update({ calls, events, checks, summary: lifetimeSummary, total, progress, stage, reference, desktopPreview: Boolean(desktopWindow && player.active && document.body.classList.contains('presentation')), visualState, statusMessage: stateLabels[visualState], bridgeConnected, modelOpen, duration: player.active ? demoFrame.duration : 0, demo: player.active, paused: player.active && !demoFrame.playing, running: run?.status === 'running' && (player.active || pending > 0 || modelOpen), elapsed: player.active ? demoFrame.elapsed : run ? (run.endedAt || Date.now()) - run.startedAt : 0, startedAt: run?.startedAt || 0, clockStart: 0, sourceLabel: player.active ? SCENARIOS[demoFrame.scene].source.split(' / ')[0] : calls.at(-1)?.source?.split(' / ')[0] || 'MCP', readerLines });
  refreshThemedSelects(document);
  updatePlaybackControls();
  updatePreferencesSummary();
  renderElapsed();
}
function renderElapsed() {
  const run = state.runs.find(r => r.id === state.selected);
  const seconds = player.active && demoFrame ? Math.floor(demoFrame.elapsed / 1000) : run ? Math.max(0, Math.floor(((run.endedAt || Date.now()) - run.startedAt) / 1000)) : 0;
  $('#elapsed').textContent = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}
setInterval(() => { renderElapsed(); if (!player.active && state.runs.find(r => r.id === state.selected)?.status === 'running') queueRender(); }, 1000);

function renderOutput(events, calls) {
  const panel = $('#response-content');
  const stick = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 50;
  const run = state.runs.find(r => r.id === state.selected);
  const trimmed = !player.active && run?.summary?.events > events.length;
  const retentionNotice = trimmed ? '<p class="field-note">Output may be incomplete: earlier events are outside the retention window. Header counts still cover the session lifetime.</p>' : '';
  const selected = state.selectedCall && calls.find(c => c.callId === state.selectedCall);
  const messages = new Map();
  for (const e of events) if (e.type === 'model.delta') { const key = e.messageId || 'external'; messages.set(key, (messages.get(key) || '') + (e.text || '')); }
  const visibleCall = selected || (!messages.size ? calls.at(-1) : null);
  const errors = events.filter(e => e.level === 'error' || (e.type === 'run.end' && e.status === 'failed'));
  const context = `${player.active ? 'preview' : 'live'}:${run?.id || 'empty'}:${visibleCall ? `tool:${visibleCall.callId || visibleCall.id}` : 'answer'}`;
  const key = `${context}:${visibleCall?.end?.id || ''}:${visibleCall?.pending ?? ''}:${visibleCall?.startAvailable ?? ''}:${!visibleCall && messages.size ? events.findLast(e => e.type === 'model.delta')?.id : ''}:${!visibleCall ? errors.at(-1)?.id || '' : ''}:${run?.status || ''}:${trimmed}:${!visibleCall ? events[0]?.id || '' : ''}`;
  $('#detail-heading').textContent = visibleCall ? selected ? 'TOOL DETAILS' : 'LATEST TOOL RESULT' : 'AGENT OUTPUT';
  $('#show-output').hidden = !selected;
  $('#show-output').textContent = 'Overview';
  if (key === outputRenderKey) return;
  let html;
  if (visibleCall) html = renderToolResult(visibleCall);
  else if (messages.size) html = [...messages.values()].map((text, i) => `<div class="output-label">RESPONSE ${pad(i + 1)}</div>${renderAgentText(text)}`).join('');
  else if (events.length || run) html = `<div class="output-label">${errors.length ? 'TASK ERROR' : 'AWAITING OUTPUT'}</div>${renderAgentText(errors.length ? errors.at(-1).message || 'Task failed. Review the event log.' : run?.summary?.calls ? 'Earlier tool details are outside the retention window. Lifetime totals are preserved, and new results can still arrive.' : 'Task connected. Waiting for agent output or tool events…')}`;
  else html = '<div class="welcome"><span class="welcome-kicker">READY WHEN YOU ARE.</span><h2>See your agent<br>at work.</h2><p>Model decisions, tool calls, and results<br>unfold in a single live event stream.</p><button id="welcome-connect">Connect an agent <span>↗</span></button><small>Choose Demo to preview the workflow</small></div>';
  const sameContext = context === outputRenderContext, scrollTop = panel.scrollTop;
  const openSections = sameContext ? [...panel.querySelectorAll('details[open][data-result-section]')].map(el => el.dataset.resultSection) : [];
  panel.innerHTML = retentionNotice + html;
  for (const el of panel.querySelectorAll('details[data-result-section]')) if (openSections.includes(el.dataset.resultSection)) el.open = true;
  outputRenderKey = key; outputRenderContext = context;
  panel.scrollTop = !sameContext ? 0 : stick && messages.size && !visibleCall ? panel.scrollHeight : scrollTop;
}
function describe(e) {
  switch (e.type) {
    case 'run.start': return ['session', e.title || 'Task started'];
    case 'run.end': return ['session', e.message || `Task ${e.status}`];
    case 'stage': return ['phase', e.message || stageLabels[e.stage]];
    case 'tool.start': return [e.source || 'tool', `${e.name} ← ${short(e.args, 70)}`];
    case 'tool.end': return [e.ok ? 'success' : 'error', `${e.name} · ${e.durationMs ?? '—'} ms · ${e.ok ? 'Success' : 'Failed'}`];
    case 'model.start': return ['model', `${e.model || 'Agent'} · Request ${e.round || ''}`];
    case 'model.end': return ['model', 'Model response ended'];
    case 'check': return ['check', `${e.name} · ${e.status}`];
    case 'artifact': return ['artifact', e.name || e.path || 'New artifact'];
    default: return [e.level || 'log', e.message || e.text || e.type];
  }
}
function renderTimeline(events, calls = []) {
  const panel = $('#timeline');
  if (player.active && document.body.classList.contains('presentation')) delete panel.dataset.renderKey;
  if (player.active && demoFrame.scene === 'cleanroom' && document.body.classList.contains('presentation')) {
    const r = referenceState(demoFrame.elapsed, demoFrame.duration), { log } = r;
    panel.innerHTML = `<div class="log-row reference-event"><time>d${pad(log.day)}</time><span class="log-type log-${log.type}">${log.type}</span><p>${esc(log.text)}</p></div><div class="log-row reference-rule"><time>d${pad(r.day)}</time><span class="log-type">rule</span><p>${esc(log.rule)}</p></div>`;
    return;
  }
  if (player.active && document.body.classList.contains('presentation')) {
    const step = Math.min(12, Math.floor(demoFrame.elapsed / demoFrame.duration * 12) + 1), last = calls.at(-1);
    const success = calls.filter(c => c.end?.ok).length;
    const done = demoFrame.run.status === 'completed';
    const type = done ? 'done' : last?.end?.ok === false ? 'retry' : 'rea';
    const message = done ? `${calls.length} calls · ${success} successful · ${calls.length - success} flagged · DEMO` : last ? `${last.name} ${short(last.args?.procedure || last.args?.path || last.args?.topic || '', 26)} → ${last.pending ? 'running' : last.end?.ok ? 'result captured' : 'retry queued'}` : 'receive task → read context → plan the next move';
    const rule = ['read the context before you act', 'the record is the memory, not the chat', 'every result needs a trace', 'test the checker too'][Math.floor((step - 1) / 3) % 4];
    panel.innerHTML = `<div class="log-row ${type === 'retry' ? 'error' : ''}"><time>s${pad(step)}</time><span class="log-type">${type}</span><p>${esc(message)}</p></div><div class="log-row"><time>s${pad(step)}</time><span class="log-type">rule</span><p>${esc(rule)}</p></div>`;
    return;
  }
  const stick = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 40;
  const rows = events.filter(e => e.type !== 'model.delta').filter(e => !state.filter || describe(e).join(' ').toLowerCase().includes(state.filter)).slice(-300);
  const logKey = `${state.selected}:${state.filter}:${rows.map(e => e.id).join(',')}`;
  if (panel.dataset.renderKey === logKey) return;
  panel.dataset.renderKey = logKey;
  if (events.length) panel.innerHTML = rows.map(e => { const [kind, text] = describe(e); return `<div class="log-row ${e.level === 'error' || e.ok === false || e.status === 'failed' ? 'error' : e.ok === true || e.status === 'completed' ? 'success' : ''}"><time>${clock(e.at)}</time><span class="log-type" title="${esc(kind)}">${esc(kind)}</span><p>${esc(text)}</p></div>`; }).join('') || '<p class="field-note">No matching events</p>';
  if (stick) panel.scrollTop = panel.scrollHeight;
}
function renderToolLibrary() {
  const filter = $('#tool-search').value.toLowerCase();
  let count = 0;
  $('#tool-library').innerHTML = state.connections.map(server => {
    count += server.tools.filter(t => t.enabled).length;
    const tools = server.tools.filter(t => t.name.toLowerCase().includes(filter));
    return `<div class="server-heading"><span>${esc(server.name)} · ${server.tools.length} TOOLS · ${esc(server.status)}</span><button data-disconnect="${esc(server.id)}">Disconnect</button></div>${tools.map(t => `<label class="tool-choice"><input type="checkbox" data-server="${esc(server.id)}" data-tool="${esc(t.name)}" ${t.enabled ? 'checked' : ''} ${server.status !== 'connected' ? 'disabled' : ''}><span><b>${esc(t.name)}</b><small>${esc(t.description || '')}</small></span></label>`).join('')}`;
  }).join('') || '<div class="empty-library">No tool server connected</div>';
  $('#selected-count').textContent = `${count} / 32 SELECTED`;
  const select = $('#manual-tool'), old = select.value;
  select.innerHTML = state.connections.filter(s => s.status === 'connected').flatMap(s => s.tools.map(t => `<option value="${esc(JSON.stringify([s.id, t.name]))}">${esc(s.name)} / ${esc(t.name)}</option>`)).join('') || '<option value="">Connect a tool server first</option>';
  if (old && [...select.options].some(o => o.value === old)) select.value = old;
  else {
    const preferred = [...select.options].find(o => o.textContent.endsWith('/ binary_session'));
    if (preferred) select.value = preferred.value;
  }
}
async function openSettings(tab = 'model') {
  $('#connect-dialog').showModal();
  setTab(tab); dialogStatus('');
  try { await loadWorkspaceSetup(); }
  catch (error) { dialogStatus(error.message, true); }
}
async function loadWorkspaceSetup(refresh = false) {
  if (!liveState.setup || refresh) liveState.setup = await api('/setup');
  state.setup = liveState.setup;
  $('#bridge-url').textContent = location.origin + '/api/events';
  $('#bridge-token').value = liveState.setup.bridgeToken;
  renderHelpConfig(liveState.setup);
  return liveState.setup;
}
function codexConfig(setup, includeToken = false) {
  const quote = value => JSON.stringify(String(value));
  const integration = setup.integration;
  const args = [integration.proxyScript, '--name', 'Codex REA', '--', setup.rea.command, ...setup.rea.args];
  return `[mcp_servers.agent_bay_rea]\ncommand = ${quote(integration.command)}\nargs = [\n${args.map(arg => `  ${quote(arg)},`).join('\n')}\n]\nstartup_timeout_sec = 30\n\n[mcp_servers.agent_bay_rea.env]\nAGENT_BAY_URL = ${quote(location.origin)}\nAGENT_BAY_BRIDGE_TOKEN = ${quote(includeToken ? setup.bridgeToken : 'PASTE_YOUR_TOKEN_HERE')}`;
}
function renderHelpConfig(setup) {
  const ready = Boolean(setup?.integration?.command && setup.integration.proxyScript && setup.rea?.command);
  $('#help-copy-config').disabled = !ready;
  $('#help-codex-config').textContent = ready ? codexConfig(setup) : '# Install REA, then click Refresh to detect its local command.';
  $('#help-config-status').textContent = ready ? 'REA detected. Copy config includes the current bridge token; the preview keeps it hidden.' : 'Local REA connection details are unavailable. Install REA and refresh this guide.';
}
async function refreshHelpSetup(refresh = false) {
  try { await loadWorkspaceSetup(refresh); }
  catch (error) {
    $('#help-config-status').textContent = `Could not load connection details: ${error.message}`;
    $('#help-copy-config').disabled = true;
  }
}
function selectHelpTopic(topic) {
  for (const button of document.querySelectorAll('[data-help-topic]')) {
    const active = button.dataset.helpTopic === topic;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll('[data-help-panel]')) panel.hidden = panel.dataset.helpPanel !== topic;
  $('.preferences-content').scrollTop = 0;
  if (topic === 'codex') void refreshHelpSetup();
}
function selectPreferencesTab(tab) {
  for (const button of document.querySelectorAll('[data-preferences-tab]')) {
    const active = button.dataset.preferencesTab === tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll('[data-preferences-panel]')) panel.hidden = panel.dataset.preferencesPanel !== tab;
  $('#preferences-title').textContent = tab === 'help' ? 'Help & setup' : 'Settings';
  $('#preferences-subtitle').textContent = tab === 'help' ? 'Connect a model, run tools, or bring your agent' : 'Appearance and connections';
  $('#settings-page').setAttribute('aria-label', tab === 'help' ? 'Help and setup' : 'Settings');
  $('.preferences-content').scrollTop = 0;
}
let preferencesContext = null;
function updatePreferencesSummary() {
  $('#preferences-model').textContent = liveState.model ? `${liveState.model.model} · ${liveState.model.protocol}` : 'No model connected';
  const connected = liveState.connections.filter(connection => connection.status === 'connected').length;
  $('#preferences-tools').textContent = connected ? `${connected} connected ${connected === 1 ? 'server' : 'servers'}` : 'No tool servers connected';
  for (const button of document.querySelectorAll('[data-preferences-connect],[data-help-connect]')) button.disabled = player.active;
}
function openPreferencesPage(tab) {
  if (tab) selectPreferencesTab(tab);
  if (!$('#settings-page').hidden) return;
  preferencesContext = { presentation: document.body.classList.contains('presentation'), playing: player.active && player.playing };
  if (preferencesContext.playing) player.pause();
  document.body.classList.remove('presentation');
  document.body.classList.add('settings-open');
  $('#settings-page').hidden = false;
  updatePreferencesSummary(); updatePlaybackControls();
  $('#close-settings-page').focus();
}
function closePreferencesPage() {
  if ($('#settings-page').hidden) return;
  $('#settings-page').hidden = true;
  document.body.classList.remove('settings-open');
  if (preferencesContext?.presentation && player.active) document.body.classList.add('presentation');
  if (preferencesContext?.playing && player.active) player.resume();
  preferencesContext = null;
  queueRender();
  (desktopWindow ? $('#app-settings-btn') : $('#preferences-btn')).focus();
}
$('#preferences-btn').onclick = () => openPreferencesPage();
$('#help-btn').onclick = () => { selectHelpTopic('start'); openPreferencesPage('help'); };
$('#app-settings-btn').onclick = () => $('#settings-page').hidden ? openPreferencesPage() : closePreferencesPage();
$('#close-settings-page').onclick = closePreferencesPage;
for (const button of document.querySelectorAll('[data-preferences-tab]')) button.onclick = () => selectPreferencesTab(button.dataset.preferencesTab);
for (const button of document.querySelectorAll('[data-help-topic]')) button.onclick = () => selectHelpTopic(button.dataset.helpTopic);
for (const button of document.querySelectorAll('[data-help-open]')) button.onclick = () => { selectHelpTopic(button.dataset.helpOpen); openPreferencesPage('help'); };
for (const button of document.querySelectorAll('[data-help-connect]')) button.onclick = () => openSettings(button.dataset.helpConnect);
$('#help-refresh-config').onclick = () => refreshHelpSetup(true);
$('#help-copy-config').onclick = async () => {
  try { await navigator.clipboard.writeText(codexConfig(await loadWorkspaceSetup(), true)); toast('Codex configuration copied with the current bridge token'); }
  catch { toast('Could not copy configuration. Copy the preview and add the token from Event connection.', true); }
};
for (const button of document.querySelectorAll('[data-preferences-connect]')) button.onclick = () => openSettings(button.dataset.preferencesConnect);
function setTab(tab) { document.querySelectorAll('[data-tab]').forEach(el => { const active = el.dataset.tab === tab; el.classList.toggle('active', active); el.setAttribute('aria-selected', active); }); document.querySelectorAll('.tab-panel').forEach(el => el.hidden = el.id !== `tab-${tab}`); dialogStatus(''); }
$('#settings-btn').onclick = () => openSettings();
$('#tools-btn').onclick = () => openSettings('tools');
$('#close-dialog').onclick = () => $('#connect-dialog').close();
$('#connect-dialog').addEventListener('click', event => { if (event.target === $('#connect-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => setTab(el.dataset.tab));
$('#response-content').onclick = async e => {
  if (e.target.closest('#welcome-connect')) { openSettings(); return; }
  const button = e.target.closest('[data-copy-result]');
  if (!button) return;
  const text = button.closest('.result-code-block, .result-details')?.querySelector('pre')?.textContent;
  if (text == null) return;
  try { await navigator.clipboard.writeText(text); toast('Copied current content'); }
  catch { toast('Clipboard access was denied. Select and copy the text manually.', true); }
};
$('#run-select').onchange = event => { state.selected = event.target.value; state.selectedCall = null; state.follow = state.selected === state.runs.at(-1)?.id; queueRender(); };
$('#tool-feed').onclick = event => { const button = event.target.closest('[data-call]'); if (button) { state.selectedCall = button.dataset.call; queueRender(); } };
$('#show-output').onclick = () => { state.selectedCall = null; queueRender(); };
$('#log-search').oninput = event => { state.filter = event.target.value.toLowerCase(); queueRender(); };
$('#tool-search').oninput = renderToolLibrary;
$('#protocol').onchange = () => { if (!$('#base-url').value && $('#protocol').value === 'anthropic') $('#base-url').value = 'https://api.anthropic.com/v1'; };
$('#mcp-transport').onchange = () => { const http = $('#mcp-transport').value === 'http'; $('#http-fields').hidden = !http; $('#stdio-fields').hidden = http; };
$('#copy-token').onclick = async () => { try { await navigator.clipboard.writeText($('#bridge-token').value); toast('Event bridge token copied'); } catch { $('#bridge-token').type = 'text'; $('#bridge-token').select(); toast('Copy the selected token manually'); } };
$('#model-form').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; dialogStatus('Saving…');
  try { const result = await api('/model', { protocol: $('#protocol').value, baseUrl: $('#base-url').value, model: $('#model-id').value, apiKey: $('#api-key').value }); state.model = result; $('#api-key').value = ''; renderConnections(); dialogStatus('Saved. The API connection is checked when a task starts.'); toast('Model configuration saved'); }
  catch (error) { dialogStatus(error.message, true); } finally { button.disabled = false; }
};
$('#clear-model').onclick = async () => { try { await api('/model/clear', {}); state.model = null; $('#api-key').value = ''; renderConnections(); queueRender(); dialogStatus('Model configuration cleared'); } catch (error) { dialogStatus(error.message, true); } };
$('#connect-rea').onclick = async () => {
  const button = $('#connect-rea'); button.disabled = true; dialogStatus('Starting REA MCP and discovering tools…');
  try { state.setup ||= await api('/setup'); if (!state.setup.rea.command) throw new Error('REA was not found. Add an MCP server with the Node executable and rea.mjs mcp arguments.'); const result = await api('/mcp/connect', { name: 'REA', ...state.setup.rea }); dialogStatus(`REA connected with ${result.count} tools. Select tools for the model or call them manually below.`); toast(`REA connected · ${result.count} tools`); }
  catch (error) { dialogStatus(error.message, true); } finally { button.disabled = false; }
};
$('#mcp-form').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; dialogStatus('Connecting to the MCP server…');
  try { const input = $('#mcp-transport').value === 'http' ? { url: $('#mcp-url').value, token: $('#mcp-token').value } : { command: $('#mcp-command').value, args: JSON.parse($('#mcp-args').value) }; const result = await api('/mcp/connect', { name: $('#mcp-name').value, ...input }); $('#mcp-token').value = ''; dialogStatus(`Connected to ${result.name} · ${result.count} tools`); }
  catch (error) { dialogStatus(error.message, true); } finally { button.disabled = false; }
};
$('#tool-library').onchange = async event => {
  const input = event.target; if (!input.dataset.server) return;
  const server = state.connections.find(s => s.id === input.dataset.server);
  const names = server.tools.filter(t => t.name === input.dataset.tool ? input.checked : t.enabled).map(t => t.name);
  try { await api('/mcp/select', { serverId: server.id, names }); dialogStatus('Tool selection updated'); }
  catch (error) { input.checked = !input.checked; dialogStatus(error.message, true); }
};
$('#tool-library').onclick = async event => { const button = event.target.closest('[data-disconnect]'); if (!button) return; try { await api('/mcp/disconnect', { serverId: button.dataset.disconnect }); dialogStatus('Tool server disconnected'); } catch (error) { dialogStatus(error.message, true); } };
$('#call-form').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { const [serverId, name] = JSON.parse($('#manual-tool').value); const result = await api('/mcp/call', { serverId, name, args: JSON.parse($('#manual-args').value) }); state.selected = result.runId; state.selectedCall = null; state.follow = true; $('#connect-dialog').close(); toast('Tool call started'); queueRender(); }
  catch (error) { dialogStatus(error.message, true); } finally { button.disabled = false; }
};
$('#task-form').onsubmit = async event => {
  event.preventDefault();
  if (!state.model) { toast('Connect a model API before starting a task'); openSettings('model'); return; }
  $('#run-btn').disabled = true;
  try { const result = await api('/run', { prompt: $('#prompt').value, target: $('#target').value }); state.selected = result.runId; state.selectedCall = null; state.follow = true; queueRender(); }
  catch (error) { toast(error.message, true); $('#run-btn').disabled = false; }
};
$('#stop-btn').onclick = async () => { try { await api('/stop', {}); toast('Stopping model requests and tool calls…'); } catch (error) { toast(error.message, true); } };
$('#demo-btn').onclick = () => $('#preview-dialog').showModal();
async function pickTarget(directory) {
  if (!desktopInvoke || pickingTarget || player.active) return;
  pickingTarget = true; render();
  try {
    const path = await desktopInvoke('pick_target_path', { directory });
    if (path) { $('#target').value = path; $('#target').dispatchEvent(new Event('input', { bubbles: true })); }
  } catch (error) { toast(`Could not select target: ${error.message || error}`, true); }
  finally { pickingTarget = false; queueRender(); }
}
$('#browse-file').onclick = () => pickTarget(false);
$('#browse-folder').onclick = () => pickTarget(true);
$('#export-btn').onclick = async () => {
  if (exporting) return;
  const run = state.runs.find(r => r.id === state.selected); if (!run) return;
  const events = state.events.filter(e => e.runId === run.id);
  const retention = { eventLimit: liveState.eventLimit, retainedEvents: events.length, totalEvents: !player.active ? run.summary?.events ?? events.length : events.length, note: 'Event details cover the retention window; run.summary contains lifetime session totals.' };
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), run, events, retention }, null, 2);
  const defaultName = `agent-bay-${run.id}.json`;
  if (desktopInvoke) {
    exporting = true; render();
    try { const path = await desktopInvoke('save_export', { data, defaultName }); if (path) toast('Session exported'); }
    catch (error) { toast(`Could not export session: ${error.message || error}`, true); }
    finally { exporting = false; queueRender(); }
  } else {
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = defaultName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
const player = new DemoPlayer(frame => {
  demoFrame = frame;
  const previous = state !== liveState ? state : null;
  state = { runs: [frame.run], events: frame.events, connections: [], model: null, selected: frame.run.id, selectedCall: previous?.selectedCall || null, filter: previous?.filter || '', setup: null, follow: true };
  $('#stream-dot').className = 'dot demo'; $('#stream-label').textContent = 'DEMO PREVIEW';
  $('#preview-pause').textContent = frame.playing ? 'Ⅱ Pause' : frame.elapsed >= frame.duration ? '▷ Replay' : '▷ Resume';
  $('#preview-position').value = frame.elapsed;
  $('#preview-position').max = frame.duration;
  $('#preview-time').textContent = `${pad(Math.floor(frame.elapsed / 1000))} / ${Math.round(frame.duration / 1000)}s`;
  $('#preview-speed').value = frame.speed;
  $('#preview-loop').checked = frame.loop;
  document.body.classList.toggle('preview-paused', !frame.playing);
  $('.brand-icon svg').style.transform = `translateY(${Math.sin(frame.elapsed / 260) * 1.2}px)`;
  const svg = $('.flow-svg');
  if (!frame.playing) svg.pauseAnimations?.(); else svg.unpauseAnimations?.();
  const captions = { observe: ['CONTEXT', 'Bring the task into view'], reason: ['REASON', 'Understand the task and plan the next step'], execute: ['EXECUTE', 'See every tool call'], verify: ['VERIFY', 'Follow execution, results, and verification'] };
  const [label, text] = captions[frame.run.stage];
  $('#promo-caption-label').textContent = frame.run.status === 'completed' ? 'AGENT BAY' : label;
  $('#promo-caption-text').textContent = frame.run.status === 'completed' ? 'Any agent. One visual workspace.' : text;
  renderConnections();
  if (frame.scene === 'cleanroom') { const now = performance.now(); if (!frame.playing || now - lastPreviewRender >= 1000 / 30) { lastPreviewRender = now; render(); } }
  else queueRender();
});
function startPreview(options) {
  if (desktopWindow) options = { ...options, exportFormat: options.exportFormat || options.format || 'square', format: 'fit' };
  $('#preview-dialog').close();
  state = liveState;
  document.body.classList.add('preview-active');
  document.body.classList.toggle('presentation', options.presentation !== false);
  document.body.classList.toggle('preview-controls-hidden', options.controls === false);
  document.body.dataset.format = ['fit', 'wide', 'square', 'portrait'].includes(options.format) ? options.format : 'square';
  $('#preview-controls').hidden = false;
  $('#preview-scene-name').textContent = SCENARIOS[options.scene || 'reverse'].name;
  player.start(options);
  if (options.autoplay === false) player.pause();
}
function exitPreview() {
  player.stop(); demoFrame = null; state = liveState;
  document.body.classList.remove('preview-active', 'presentation', 'preview-paused', 'preview-controls-hidden');
  $('#preview-controls').hidden = true;
  $('.flow-svg').unpauseAnimations?.();
  $('.brand-icon svg').style.transform = '';
  $('#stream-dot').className = bridge.readyState === EventSource.OPEN ? 'dot' : 'dot off';
  $('#stream-label').textContent = bridge.readyState === EventSource.OPEN ? 'LIVE BRIDGE' : 'RECONNECTING';
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  renderConnections(); queueRender();
}
$('#preview-form').onsubmit = event => { event.preventDefault(); startPreview({ scene: $('#preview-scene').value, duration: Number($('#preview-duration').value), format: $('#preview-format').value, presentation: $('#preview-presentation').checked, loop: $('#preview-loop-start').checked }); };
$('#close-preview-dialog').onclick = () => $('#preview-dialog').close();
$('#preview-pause').onclick = () => player.playing ? player.pause() : player.resume();
$('#preview-restart').onclick = () => player.restart();
$('#preview-exit').onclick = exitPreview;
$('#preview-position').oninput = event => player.seek(Number(event.target.value));
$('#preview-speed').onchange = event => player.setSpeed(event.target.value);
$('#preview-loop').onchange = event => { player.loop = event.target.checked; };
function updatePlaybackControls() {
  $('#preview-show-controls').hidden = !player.active || !document.body.classList.contains('preview-controls-hidden') || exportOnly || player.options.controls === false || !$('#settings-page').hidden;
  if (exportOnly) $('#preview-controls').hidden = true;
}
$('#preview-hide').onclick = () => { document.body.classList.add('preview-controls-hidden'); updatePlaybackControls(); };
$('#preview-show-controls').onclick = () => { document.body.classList.remove('preview-controls-hidden'); updatePlaybackControls(); };
let videoExportController = null, videoPreviewPlaying = false;
$('#preview-download').onclick = () => {
  if (!player.active) return;
  videoPreviewPlaying = player.playing;
  if (videoPreviewPlaying) player.pause();
  const format = player.options.exportFormat || player.options.format;
  $('#video-export-format').value = ['square', 'wide', 'portrait'].includes(format) ? format : 'square';
  $('#video-export-form').hidden = false;
  $('#video-export-progress').hidden = true;
  $('#video-export-status').textContent = '';
  $('#video-export-cancel').textContent = 'Close';
  $('#video-export-dialog').showModal();
  refreshThemedSelects(document);
};
function closeVideoExport() {
  if (videoExportController) { videoExportController.abort(); return; }
  $('#video-export-dialog').close();
}
$('#video-export-close').onclick = closeVideoExport;
$('#video-export-cancel').onclick = closeVideoExport;
$('#video-export-dialog').addEventListener('cancel', event => {
  if (videoExportController) { event.preventDefault(); videoExportController.abort(); }
});
$('#video-export-dialog').addEventListener('close', () => {
  if (videoPreviewPlaying && player.active) player.resume();
  videoPreviewPlaying = false;
});
const blobBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('Could not prepare the video for saving.'));
  reader.readAsDataURL(blob);
});
$('#video-export-form').onsubmit = async event => {
  event.preventDefault();
  if (!player.active || videoExportController) return;
  videoExportController = new AbortController();
  const signal = videoExportController.signal;
  $('#video-export-form').hidden = true;
  $('#video-export-progress').hidden = false;
  $('#video-export-progress').value = 0;
  $('#video-export-status').textContent = 'Preparing video…';
  $('#video-export-cancel').textContent = 'Cancel export';
  try {
    const { exportDemoVideo } = await import('./demo-export.js');
    const result = await exportDemoVideo({ scene: demoFrame.scene, duration: demoFrame.duration / 1000, format: $('#video-export-format').value, fps: 30, signal, onProgress: progress => {
      $('#video-export-progress').value = progress.progress;
      $('#video-export-status').textContent = progress.phase === 'rendering' ? `Rendering ${progress.frame} / ${progress.totalFrames} frames…` : progress.phase === 'finalizing' ? 'Finishing video…' : 'Preparing video…';
    } });
    if (signal.aborted) throw new DOMException('Video export cancelled.', 'AbortError');
    $('#video-export-status').textContent = 'Saving video…';
    if (desktopInvoke) {
      const base64 = await blobBase64(result.blob);
      if (signal.aborted) throw new DOMException('Video export cancelled.', 'AbortError');
      const path = await desktopInvoke('save_video', { base64, defaultName: result.filename });
      if (path) toast('Video saved');
    } else {
      const url = URL.createObjectURL(result.blob), link = document.createElement('a');
      link.href = url; link.download = result.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('Video download started');
    }
    $('#video-export-dialog').close();
  } catch (error) {
    $('#video-export-status').textContent = error.name === 'AbortError' ? 'Video export cancelled.' : `Video export failed: ${error.message || error}`;
    $('#video-export-form').hidden = false;
  } finally {
    videoExportController = null;
    $('#video-export-cancel').textContent = 'Close';
  }
};
$('#preview-fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('Fullscreen was denied. Use F11 instead.'); } };
document.addEventListener('keydown', event => {
  if (event.defaultPrevented) return;
  if (event.key === 'Escape' && !$('#settings-page').hidden && !document.querySelector('dialog[open]')) { closePreferencesPage(); return; }
  if (!player.active || event.target.closest('input,textarea,select,button,dialog,[role=combobox],[role=listbox],[role=option]')) return;
  if (event.code === 'Space') { event.preventDefault(); player.playing ? player.pause() : player.resume(); }
  if (event.key.toLowerCase() === 'r') player.restart();
  if (event.key.toLowerCase() === 'h') { document.body.classList.toggle('preview-controls-hidden'); updatePlaybackControls(); }
  if (event.key.toLowerCase() === 'f') $('#preview-fullscreen').click();
  if (event.key === 'Escape') exitPreview();
});
window.agentBayPreview = { start: startPreview, pause: () => player.pause(), resume: () => player.resume(), seek: ms => player.seek(ms), renderAt: ms => { player.pause(); player.seek(ms); render(); factory.draw(ms); }, exit: exitPreview, factoryState: () => factory.stats && { ...factory.stats }, state: () => demoFrame && { elapsed: demoFrame.elapsed, duration: demoFrame.duration, playing: demoFrame.playing, scene: demoFrame.scene, factory: factory.stats } };
const previewQuery = new URLSearchParams(location.search);
if (previewQuery.get('preview') === '1') {
  const scene = previewQuery.get('scene') || 'reverse', duration = Number(previewQuery.get('duration') || 30);
  if (SCENARIOS[scene] && [15, 24.8, 30, 60].includes(duration)) startPreview({ scene, duration, format: previewQuery.get('format') || 'square', autoplay: previewQuery.get('autoplay') !== '0', controls: previewQuery.get('controls') !== '0', loop: previewQuery.get('loop') === '1' });
}
queueRender();
