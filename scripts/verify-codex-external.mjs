import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { emit } from './emit.mjs';

// This manually instruments the current Codex conversation. The public model
// answer is supplied only after the agent has inspected the actual tool output.
const url = process.env.AGENT_BAY_URL || 'http://127.0.0.1:4319';
const setup = await (await fetch(url + '/api/setup')).json();
const send = event => emit(event, { url, token: setup.bridgeToken });
const contextPath = resolve('artifacts/codex-external-context.json');
if (process.argv[2] === 'finish') {
  const context = JSON.parse(await readFile(contextPath, 'utf8'));
  const answer = await readFile(resolve(process.argv[3] || 'artifacts/codex-external-summary.txt'), 'utf8');
  assert.ok(answer.trim(), 'the agent must supply its public, evidence-based answer');
  const base = { runId: context.runId, source: 'Codex' };
  await send({ ...base, type: 'stage', stage: 'verify', message: 'Verify actual static evidence and the public conclusion' });
  await send({ ...base, type: 'model.delta', messageId: context.messageId, text: answer });
  await send({ ...base, type: 'model.end', messageId: context.messageId, usage: {} });
  await send({ ...base, type: 'run.end', status: 'completed', message: 'Codex external event integration complete; controlled fixture statically verified' });
  console.log(JSON.stringify({ runId: context.runId, completed: true, integration: 'manual current-Codex external events; no model API configured' }));
} else {
  const runId = `codex-acceptance-${randomUUID()}`, messageId = randomUUID(), callId = randomUUID();
  const target = resolve('artifacts/managed-acceptance-fixture/bin/Release/net10.0/AgentBay.ManagedAcceptance.dll');
  const base = { runId, source: 'Codex' };
  await send({ ...base, type: 'run.start', title: 'Codex / actual REA managed assembly boundary inspection (controlled fixture)', model: 'Codex · current session / external events', target });
  await send({ ...base, type: 'model.start', messageId, model: 'Codex · current session' });
  const client = new Client({ name: 'agent-bay-codex-acceptance', version: '0.1.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({ ...setup.rea, stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  let started = 0, toolStarted = false;
  try {
    await client.connect(transport, { timeout: 30000 });
    const catalog = await client.listTools();
    assert.ok(catalog.tools.some(t => t.name === 'inspect_managed_native_boundaries'));
    await send({ ...base, type: 'stage', stage: 'execute', message: 'REA / inspect_managed_native_boundaries' });
    await send({ ...base, type: 'tool.start', callId, name: 'inspect_managed_native_boundaries', args: { path: target } });
    toolStarted = true; started = performance.now();
    const result = await client.callTool({ name: 'inspect_managed_native_boundaries', arguments: { path: target } }, undefined, { timeout: 120000 });
    await send({ ...base, type: 'tool.end', callId, name: 'inspect_managed_native_boundaries', ok: !result.isError, durationMs: Math.round(performance.now() - started), result });
    assert.equal(!!result.isError, false);
    await writeFile(contextPath, JSON.stringify({ runId, messageId, callId, target, result }, null, 2));
    console.log(JSON.stringify({ runId, messageId, result }, null, 2));
  } catch (error) {
    if (toolStarted) await send({ ...base, type: 'log', level: 'error', message: error.message });
    await send({ ...base, type: 'run.end', status: 'failed', message: error.message });
    throw error;
  } finally { await client.close(); }
}
