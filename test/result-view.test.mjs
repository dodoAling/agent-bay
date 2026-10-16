import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToolResult, renderAgentText, rvExtractPayload, rvHighlight } from '../public/result-view.js';

const evidence = {
  evidence_id: 'ev_fixture', subject: { name: 'fixture.dll', digest: { sha256: 'a'.repeat(64) } },
  provider: { id: 'rea-analysis-view', name: 'REA analysis view projection' },
  operation: 'inspect_analysis_view', confidence: 'derived', authority: 'shipped-artifact',
  limitations: ['Static inspection did not decompile C# or execute target code.'],
  normalized_result: {
    kind: 'managed-members', page: { collection: 'methods', rows: [{ name: 'ComputeScore', token: '0x06000001' }, { name: 'Classify', token: '0x06000002' }] },
    coverage: { status: 'page', examined: 2, total: 2, exhausted: true, next_offset: null },
    summary: { metadata: { table_row_counts: { MethodDef: 2, TypeDef: 2 } }, reported_counts: { references: 1 } },
    limitations: ['Static inspection did not decompile C# or execute target code.'], unknowns: ['External types were not resolved.']
  }
};
const successful = result => ({ name: 'inspect_analysis_view', source: 'REA', args: { path: 'fixture.dll' }, startAvailable: true, pending: false, end: { ok: true, durationMs: 42, result } });

test('REA Evidence shows reported provenance, counts, coverage and epistemic limits', () => {
  const raw = { structuredContent: evidence, content: [{ type: 'text', text: JSON.stringify(evidence) }] };
  const html = renderToolResult(successful(raw));
  const summary = html.split('<details')[0];
  for (const text of ['inspect_analysis_view', 'REA analysis view projection', 'a'.repeat(64), '42 ms', '2 / 2 examined', 'Current page · methods', 'metadata · MethodDef', 'ComputeScore', 'Derived', 'External types were not resolved.']) assert.ok(summary.includes(text), text);
  assert.ok(!summary.includes('>Inferred</span>'));
  assert.equal(summary.match(/Static inspection did not decompile/g).length, 1);
  assert.ok(html.includes('data-result-section="raw"><summary>Raw result</summary>'));
  assert.ok(!html.includes('class="result-details" open'));
  assert.deepEqual(rvExtractPayload(raw), evidence);
});

test('REA text-only MCP result parses once and keeps zero coverage', () => {
  const item = { ...evidence, confidence: 'observed', normalized_result: { coverage: { examined: 0, total: 0, status: 'complete' } } };
  const html = renderToolResult(successful({ content: [{ type: 'text', text: JSON.stringify(item) }] }));
  assert.ok(html.includes('Observed'));
  assert.ok(html.includes('0 / 0 examined'));
  assert.deepEqual(rvExtractPayload({ content: [{ type: 'text', text: JSON.stringify(item) }] }), item);
});

test('nonstandard producer confidence retains its value instead of becoming observed or inferred', () => {
  const html = renderToolResult(successful({ structuredContent: { ...evidence, confidence: 'deterministic-projection' } }));
  const summary = html.split('<details')[0];
  assert.ok(summary.includes('unrecognized classification: deterministic-projection'));
  assert.ok(!summary.includes('>Observed</span>'));
  assert.ok(!summary.includes('>Inferred</span>'));
});

test('pending, failure and unreported status remain distinct', () => {
  const pending = renderToolResult({ name: 'decompile_function', pending: true, args: {} });
  assert.ok(pending.includes('data-result-status="running"'));
  assert.ok(pending.includes('Waiting for tool result'));
  assert.ok(!pending.includes('Normalized result'));
  const failed = renderToolResult({ ...successful({ error: '<img src=x onerror=alert(1)>' }), end: { ok: false, result: { error: '<img src=x onerror=alert(1)>' } } });
  assert.ok(failed.includes('data-result-status="error"'));
  assert.ok(failed.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!failed.includes('<img'));
  const unknown = renderToolResult({ name: 'inspect', end: { result: null } });
  assert.ok(unknown.includes('data-result-status="unknown"'));
  assert.ok(unknown.includes('Status not reported'));
});

test('MCP isError cannot be presented as success by the outer transport', () => {
  const html = renderToolResult(successful({ isError: true, content: [{ type: 'text', text: 'No analysis engine' }] }));
  assert.ok(html.includes('data-result-status="error"'));
  assert.ok(html.includes('No analysis engine'));
});

test('unretained starts do not invent empty input or claim unavailable args', () => {
  const html = renderToolResult({ ...successful({ ready: true }), args: { injected: 'must not present unavailable data' }, startAvailable: false });
  assert.ok(html.includes('The start event is outside the retained window'));
  assert.ok(!html.includes('must not present unavailable data'));
  const missing = renderToolResult({ name: 'inspect', end: { ok: true } });
  assert.ok(missing.includes('The end event did not include result content'));
  assert.ok(missing.includes('The start event did not provide input arguments'));
});

test('generic values render safely, shallow collections retain full raw data', () => {
  const rows = Array.from({ length: 37 }, (_, id) => ({ id, value: `item-${id}` }));
  const html = renderToolResult(successful({ rows, total: 37 }));
  const summary = html.split('<details class="result-details" data-result-section="raw"')[0];
  assert.ok(summary.includes('17 more items'));
  assert.ok(!summary.includes('item-36'));
  assert.ok(html.includes('item-36'));
  assert.ok(renderToolResult(successful(null)).includes('null'));
  assert.ok(renderToolResult(successful(false)).includes('false'));
  assert.ok(renderToolResult(successful('plain tool output')).includes('plain tool output'));
  assert.ok(summary.includes('Unknown · not reported'));
});

test('upstream truncation and the reader limit are explicit, not complete-looking', () => {
  const truncated = renderToolResult(successful({ truncated: true, totalCharacters: 160_000, preview: 'partial result <script>x</script>' }));
  assert.ok(truncated.includes('Upstream marked truncated'));
  assert.ok(truncated.includes('160,000'));
  assert.ok(truncated.includes('this is not a complete result'));
  assert.ok(!truncated.includes('<script>'));
  const large = renderToolResult(successful({ body: 'x'.repeat(130_000) }));
  assert.ok(large.includes('Raw result preview truncated'));
  assert.ok(large.length < 140_000);
});

test('all external strings, field keys, language and tool metadata are escaped', () => {
  const html = renderToolResult({ ...successful({ '" onmouseover="evil': '<script>alert(1)</script>', assembly: ['mov rax, "<svg onload=evil()>"'] }), name: '<img src=x onerror=evil()>', source: '</span><script>evil()</script>', args: { payload: '<iframe srcdoc="evil">' } });
  assert.ok(!/<(?:script|img|svg|iframe)\b/.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('tok-register'));
});

test('Markdown supports readable blocks but never executes HTML or unsafe links', () => {
  const html = renderAgentText('# Findings\n\n- observed `ret`\n- **two rows**\n\n1. inspect\n2. verify\n\n> scope matters\n\n<script>alert(1)</script>\n\n[docs](https://example.com/a?q=1&x=2) [bad](javascript:alert(1)) [data](data:text/html,evil) [relative](//evil.example)');
  for (const tag of ['<h2>Findings</h2>', '<ul>', '<ol>', '<blockquote>', '<code>ret</code>', '<strong>two rows</strong>']) assert.ok(html.includes(tag), tag);
  assert.ok(html.includes('href="https://example.com/a?q=1&amp;x=2"'));
  assert.equal(html.match(/<a /g).length, 1);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('link attributes cannot escape with quotes or entity-encoded JavaScript', () => {
  const html = renderAgentText('[quote](https://example.com/"onmouseover="alert) [encoded](javascript&#58;alert) [control](java\tscript:alert)');
  assert.ok(html.includes('https://example.com/%22onmouseover=%22alert'));
  assert.equal(html.match(/<a /g).length, 1);
  assert.ok(!html.includes('href="javascript'));
  assert.ok(!html.includes('" onmouseover='));
});

test('tokenizer respects strings versus comments and escapes code fence payloads', () => {
  const code = 'const x = "// <script>not a comment</script>"; // real comment\nreturn 37;';
  const highlighted = rvHighlight(code, 'js');
  assert.ok(highlighted.includes('<span class="tok-string">&quot;// &lt;script&gt;not a comment&lt;/script&gt;&quot;</span>'));
  assert.ok(highlighted.includes('<span class="tok-comment">// real comment</span>'));
  const markdown = renderAgentText('```js\n' + code + '\n```\n\n```" onclick="evil\n</code><img onerror=evil()>\n```');
  assert.ok(!markdown.includes('<script>'));
  assert.ok(!markdown.includes('<img'));
  assert.ok(markdown.includes('&quot; onclick=&quot;evil'));
  assert.ok(markdown.includes('&lt;/code&gt;&lt;img onerror=evil()&gt;'));
});

test('unfinished streaming fence remains code and code limits are disclosed', () => {
  const html = renderAgentText('Before\n\n```python\nprint("<img>")');
  assert.ok(html.includes('<p>Before</p>'));
  assert.ok(html.includes('tok-string'));
  assert.ok(!html.includes('<img>'));
  const large = renderAgentText('```text\n' + 'a'.repeat(50_000) + '\n```');
  assert.ok(large.includes('Code preview truncated'));
  assert.ok(large.includes('40,000 of 50,000'));
});
