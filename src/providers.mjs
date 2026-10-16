export function endpoint(base, suffix) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter an HTTP(S) API base URL without credentials, query parameters, or a fragment.');
  const clean = url.href.replace(/\/$/, '');
  return clean.endsWith(suffix) ? clean : clean + suffix;
}

export async function* readSSE(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
    if (buffer.length > 4_000_000) throw new Error('Model event is too large.');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
  buffer += decoder.decode();
  const data = buffer.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (data && data !== '[DONE]') yield JSON.parse(data);
}

async function request(url, config, body, signal) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
  } else if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]), redirect: 'error' });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 1500);
    throw new Error(`Model API returned ${response.status}: ${message}`);
  }
  return response;
}

function assertCompletionReason(protocol, reason, callCount) {
  if (!reason) throw new Error('The model response has no finish reason; completion cannot be confirmed.');
  if (reason === 'length' || reason === 'max_tokens') throw new Error('The model response reached its output limit. Narrow the task.');
  const allowed = protocol === 'anthropic' ? ['end_turn', 'stop_sequence', 'tool_use'] : ['stop', 'tool_calls'];
  if (!allowed.includes(reason)) throw new Error(`The model response did not finish normally. Finish reason: ${String(reason).slice(0, 100)}`);
  if ((reason === 'tool_calls' || reason === 'tool_use') && !callCount) throw new Error('The model requested tool use without returning tool calls; completion cannot be confirmed.');
}

export async function completion(config, messages, tools, signal, onText) {
  if (config.protocol === 'anthropic') return anthropic(config, messages, tools, signal, onText);
  const response = await request(endpoint(config.baseUrl, '/chat/completions'), config, {
    model: config.model, messages,
    ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: { name: t.alias, description: (t.description || t.name).slice(0, 1800), parameters: t.inputSchema } })) } : {}),
    stream: true
  }, signal);
  let content = '', usage = {}, finishReason;
  const calls = new Map();
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Model API error');
    const choice = data.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error('The API response is not in Chat Completions format.');
    assertCompletionReason('openai-compatible', choice.finish_reason, message.tool_calls?.length || 0);
    content = message.content || ''; onText(content);
    return { content, calls: (message.tool_calls || []).map(c => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })), usage: data.usage || {}, raw: { role: 'assistant', content, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) } };
  }
  for await (const data of readSSE(response.body)) {
    if (data.error) throw new Error(data.error.message || 'Model stream error');
    if (data.usage) usage = data.usage;
    const choice = data.choices?.[0];
    if (!choice) continue;
    finishReason = choice.finish_reason || finishReason;
    const delta = choice.delta || {};
    if (delta.content) { content += delta.content; onText(delta.content); }
    for (const call of delta.tool_calls || []) {
      const old = calls.get(call.index) || { id: '', name: '', arguments: '' };
      if (call.id) old.id += call.id;
      if (call.function?.name) old.name += call.function.name;
      if (call.function?.arguments) old.arguments += call.function.arguments;
      calls.set(call.index, old);
    }
  }
  if (!finishReason) throw new Error('The model stream ended without a finish marker.');
  const list = [...calls.values()];
  assertCompletionReason('openai-compatible', finishReason, list.length);
  return { content, calls: list, usage, raw: { role: 'assistant', content: content || null, ...(list.length ? { tool_calls: list.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}) } };
}

async function anthropic(config, messages, tools, signal, onText) {
  const response = await request(endpoint(config.baseUrl, '/messages'), config, {
    model: config.model, max_tokens: 4096,
    system: messages[0].content, messages: messages.slice(1),
    ...(tools.length ? { tools: tools.map(t => ({ name: t.alias, description: (t.description || t.name).slice(0, 1800), input_schema: t.inputSchema })) } : {}), stream: true
  }, signal);
  const blocks = new Map();
  let usage = {}, stop = false, stopReason;
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = await response.json();
    if (data.type === 'error' || data.error) throw new Error(data.error?.message || 'Model API error');
    if (!Array.isArray(data.content)) throw new Error('The API response is not in Messages format.');
    assertCompletionReason('anthropic', data.stop_reason, data.content.filter(b => b.type === 'tool_use').length);
    const content = data.content.filter(b => b.type === 'text').map(b => b.text).join(''); onText(content);
    return { content, calls: data.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input) })), usage: data.usage || {}, raw: { role: 'assistant', content: data.content } };
  }
  for await (const event of readSSE(response.body)) {
    if (event.type === 'error') throw new Error(event.error?.message || 'Model stream error');
    if (event.type === 'message_start') usage = { ...event.message.usage };
    if (event.type === 'content_block_start') blocks.set(event.index, { ...event.content_block, json: '' });
    if (event.type === 'content_block_delta') {
      const block = blocks.get(event.index);
      if (!block) continue;
      if (event.delta.type === 'text_delta') { block.text = (block.text || '') + event.delta.text; onText(event.delta.text); }
      if (event.delta.type === 'input_json_delta') block.json += event.delta.partial_json;
      if (event.delta.type === 'thinking_delta') block.thinking = (block.thinking || '') + event.delta.thinking;
      if (event.delta.type === 'signature_delta') block.signature = (block.signature || '') + event.delta.signature;
    }
    if (event.type === 'message_delta') { usage = { ...usage, ...event.usage }; stopReason = event.delta?.stop_reason || stopReason; }
    if (event.type === 'message_stop') stop = true;
  }
  if (!stop) throw new Error('The model stream ended without a finish marker.');
  assertCompletionReason('anthropic', stopReason, [...blocks.values()].filter(b => b.type === 'tool_use').length);
  const contentBlocks = [...blocks.values()].map(({ json, ...b }) => b.type === 'tool_use' ? { ...b, input: json ? JSON.parse(json) : b.input } : b);
  return { content: contentBlocks.filter(b => b.type === 'text').map(b => b.text).join(''), calls: contentBlocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input) })), usage, raw: { role: 'assistant', content: contentBlocks } };
}
