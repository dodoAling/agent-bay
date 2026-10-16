import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { completion } from '../src/providers.mjs';

test('Unexpected model stream termination and output limits cannot count as successful answers', async () => {
  for (const finish of [null, 'length']) {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Incomplete' }, finish_reason: finish }] })}\n\n`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(completion({ protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture' }, [{ role: 'user', content: 'test' }], [], new AbortController().signal, () => {}), finish ? /output limit/ : /stream ended without a finish marker/);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
