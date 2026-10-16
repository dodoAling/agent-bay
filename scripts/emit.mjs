import { readFile } from 'node:fs/promises';

export async function emit(event, { url = process.env.AGENT_BAY_URL || 'http://127.0.0.1:4318', token = process.env.AGENT_BAY_BRIDGE_TOKEN, signal, timeoutMs = 5000 } = {}) {
  if (!token) throw new Error('Set AGENT_BAY_BRIDGE_TOKEN (dashboard > Connect > External agent)');
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url.replace(/\/$/, '') + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(event), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Event delivery failed (${response.status})`);
  return result;
}

if (process.argv[1] && import.meta.url.endsWith('/scripts/emit.mjs') && process.argv[1].replaceAll('\\', '/').endsWith('/scripts/emit.mjs')) {
  try {
    const text = process.argv[2] ? await readFile(process.argv[2], 'utf8') : await new Promise((resolve, reject) => { let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { value += chunk; if (value.length > 256000) { reject(new Error('Event is too large')); process.stdin.destroy(); } }); process.stdin.on('end', () => resolve(value)); process.stdin.on('error', reject); });
    const result = await emit(JSON.parse(text));
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
