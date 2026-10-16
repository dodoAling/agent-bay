import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';

test('Lost event ACKs can be retried idempotently, including run.start and terminal run.end', async () => {
  const app = createApp({ bridgeToken: 'delivery-fixture-token' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}/api/events`;
  const post = event => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer delivery-fixture-token' }, body: JSON.stringify(event) });
  try {
    const base = { runId: 'delivery-test', source: 'fixture-proxy' };
    const start = { ...base, eventId: 'start-1', type: 'run.start', title: 'Delivery retry' };
    assert.equal((await post(start)).status, 201);
    assert.equal((await (await post(start)).json()).duplicate, true);
    const tool = { ...base, eventId: 'call-start-1', type: 'tool.start', callId: 'call-1', name: 'inspect' };
    const first = await (await post(tool)).json();
    const again = await (await post(tool)).json();
    assert.equal(again.id, first.id); assert.equal(again.duplicate, true);
    assert.equal((await post({ ...tool, name: 'different-tool' })).status, 409);
    const endTool = { ...base, eventId: 'call-end-1', type: 'tool.end', callId: 'call-1', name: 'inspect', ok: true, result: { observed: 42 } };
    await post(endTool); await post(endTool);
    const end = { ...base, eventId: 'end-1', type: 'run.end', status: 'completed' };
    await post(end);
    assert.equal((await (await post(end)).json()).duplicate, true);
    assert.equal(app.store.events.length, 4);
    assert.equal(app.store.events.filter(e => e.type === 'tool.end').length, 1);
    assert.equal(app.store.runs.get(base.runId).status, 'completed');
    assert.equal((await post({ ...base, eventId: {}, type: 'log' })).status, 400);
  } finally { await app.close(); }
});

test('Event deduplication identities are isolated by source and session', async () => {
  const app = createApp({ bridgeToken: 'delivery-fixture-token' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}/api/events`;
  const post = event => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer delivery-fixture-token' }, body: JSON.stringify(event) });
  try {
    for (const runId of ['delivery-one', 'delivery-two']) assert.equal((await post({ runId, source: 'fixture', eventId: 'same-start', type: 'run.start' })).status, 201);
    for (const source of ['one', 'two']) assert.equal((await post({ runId: 'delivery-one', source, eventId: 'same-event', type: 'log', message: source })).status, 200);
    assert.equal(app.store.events.filter(e => e.type === 'log').length, 2);
  } finally { await app.close(); }
});
