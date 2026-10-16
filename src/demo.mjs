import { setTimeout as delay } from 'node:timers/promises';

export async function playDemo(store) {
  const run = store.start({ title: 'Demo / Analyze an application workflow', source: 'demo', mode: 'demo', model: 'DEMO AGENT', target: 'sample-app.exe' });
  const runId = run.id;
  const emit = event => store.push({ runId, source: 'demo', ...event });
  const sequence = [
    { type: 'log', message: 'This is a UI demo. Tool results and checks are preset examples; no model or REA is called.' },
    { type: 'stage', stage: 'observe', message: 'Reading target context' },
    { type: 'tool.start', callId: 'demo-1', name: 'binary_session', source: 'REA / DEMO', args: {} },
    { type: 'tool.end', callId: 'demo-1', name: 'binary_session', source: 'REA / DEMO', ok: true, durationMs: 420, result: { demo: true, target: 'sample-app.exe', format: 'PE32', architecture: 'x86' } },
    { type: 'stage', stage: 'reason', message: 'Selecting analysis tools from the context' },
    { type: 'model.start', messageId: 'demo-m1', model: 'DEMO AGENT' },
    { type: 'model.delta', messageId: 'demo-m1', text: 'First identify the entry point, then follow call relationships to inspect configuration loading and task dispatch.\n' },
    { type: 'stage', stage: 'execute', message: 'Calling tools to collect verifiable evidence' },
    { type: 'tool.start', callId: 'demo-2', name: 'list_functions', source: 'REA / DEMO', args: { limit: 3 } },
    { type: 'tool.end', callId: 'demo-2', name: 'list_functions', source: 'REA / DEMO', ok: true, durationMs: 810, result: { demo: true, functions: ['entry', 'load_config', 'dispatch_task'] } },
    { type: 'tool.start', callId: 'demo-3', name: 'decompile_function', source: 'REA / DEMO', args: { name: 'dispatch_task' } },
    { type: 'tool.end', callId: 'demo-3', name: 'decompile_function', source: 'REA / DEMO', ok: true, durationMs: 1270, result: { demo: true, pseudocode: 'int dispatch_task(Task *task) {\n  if (!task) return -1;\n  return handlers[task->kind](task);\n}' } },
    { type: 'stage', stage: 'verify', message: 'Checking conclusions against tool results' },
    { type: 'check', name: 'Entry-point evidence present (example)', status: 'passed' },
    { type: 'check', name: 'Call relationships consistent (example)', status: 'passed' },
    { type: 'model.delta', messageId: 'demo-m1', text: '\nObserved: the entry point reads configuration, then hands tasks to dispatch_task.\nInferred: handlers may be a dispatch table indexed by task type.\nUnverified: actual runtime branch coverage.\n\nThis is preset demo content. Real tasks display the data returned by the agent and tools.' },
    { type: 'model.end', messageId: 'demo-m1', usage: {} },
    { type: 'run.end', status: 'completed', message: 'Demo complete. Connect a model or REA to start a real task.' }
  ];
  for (const event of sequence) { await delay(650); emit(event); }
  return run;
}
