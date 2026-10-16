import { randomUUID } from 'node:crypto';
import { emit } from '../scripts/emit.mjs';

// This is an integration example. Replace the work() function with your agent/tool.
const runId = `example-${randomUUID()}`;
const send = event => emit({ runId, source: 'My Agent', ...event });
async function work() { return { value: 2 + 2, operation: '2 + 2' }; }

await send({ type: 'run.start', title: 'External integration example / Local calculation', model: 'No model required' });
try {
  await send({ type: 'stage', stage: 'execute', message: 'Running a local calculation' });
  await send({ type: 'tool.start', callId: 'calculate-1', name: 'calculate', args: { expression: '2 + 2' } });
  const started = performance.now();
  const result = await work();
  await send({ type: 'tool.end', callId: 'calculate-1', name: 'calculate', ok: true, durationMs: Math.round(performance.now() - started), result });
  await send({ type: 'stage', stage: 'verify', message: 'Verifying the calculation result' });
  await send({ type: 'check', name: '2 + 2 = 4', status: result.value === 4 ? 'passed' : 'failed' });
  await send({ type: 'model.delta', messageId: 'example-output', text: 'External event integration succeeded. This run performed a local calculation without calling a model.' });
  await send({ type: 'run.end', status: 'completed' });
} catch (error) { await send({ type: 'run.end', status: 'failed', message: error.message }); throw error; }
