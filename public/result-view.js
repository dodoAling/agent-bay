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
