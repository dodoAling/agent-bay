import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// The packaged file sits beside src/; the authored file lives in desktop/.
const serverModule = [new URL('./src/server.mjs', import.meta.url), new URL('../src/server.mjs', import.meta.url)].find(url => existsSync(fileURLToPath(url)));
const shutdownDeadlineMs = 5_000;
let app, input, parentWatch, stopping = false, shuttingDown;

function diagnostic(message) {
  process.stderr.write(`Agent Bay desktop: ${message}\n`);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return shuttingDown;
  stopping = true;
  clearInterval(parentWatch);
  input?.close();
  process.stdin.pause();
  shuttingDown = (async () => {
    const deadline = setTimeout(() => {
      diagnostic('Backend shutdown exceeded its deadline.');
      process.exit(exitCode || 1);
    }, shutdownDeadlineMs);
    try {
      await app?.close();
      clearTimeout(deadline);
      process.exit(exitCode);
    } catch {
      diagnostic('Backend shutdown failed.');
      clearTimeout(deadline);
      process.exit(1);
    }
  })();
  return shuttingDown;
}

process.stderr.on('error', () => {});
process.stdout.on('error', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

try {
  if (!serverModule) throw Object.assign(new Error(), { code: 'BACKEND_NOT_FOUND' });
  const rawPort = process.env.PORT ?? '0';
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) > 65_535) throw Object.assign(new Error(), { code: 'INVALID_PORT' });
  const rawParent = process.env.AGENT_BAY_PARENT_PID;
  const parentPid = rawParent === undefined ? null : Number(rawParent);
  if (rawParent !== undefined && (!/^[1-9]\d*$/.test(rawParent) || !Number.isSafeInteger(parentPid) || parentPid <= 1 || parentPid > 2_147_483_647 || parentPid === process.pid)) throw Object.assign(new Error(), { code: 'INVALID_PARENT' });
  const parentExists = () => {
    if (parentPid === null) return true;
    try { process.kill(parentPid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
  };
  if (!parentExists()) throw Object.assign(new Error(), { code: 'PARENT_GONE' });
  const { createApp } = await import(serverModule.href);
  if (!stopping) {
    app = createApp();
    input = createInterface({ input: process.stdin, terminal: false });
    input.on('line', line => { if (line.trim() === 'AGENT_BAY_SHUTDOWN') void shutdown(); });
    input.once('close', () => { if (!stopping) void shutdown(); });
    if (parentPid !== null) parentWatch = setInterval(() => { if (!parentExists()) void shutdown(); }, 750).unref();
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(Number(rawPort), '127.0.0.1', () => { app.server.off('error', reject); resolve(); });
    });
    app.server.on('error', () => { diagnostic('Backend server failed.'); void shutdown(1); });
    if (!stopping) {
      const { port } = app.server.address();
      process.stdout.write(`AGENT_BAY_READY ${JSON.stringify({ url: `http://127.0.0.1:${port}`, pid: process.pid, port })}\n`);
    }
  }
} catch (error) {
  const messages = {
    BACKEND_NOT_FOUND: 'Backend resources were not found.',
    INVALID_PORT: 'Invalid desktop backend port.',
    INVALID_PARENT: 'Invalid desktop parent process ID.',
    PARENT_GONE: 'The desktop parent process is no longer running.',
    EADDRINUSE: 'The backend port is already in use.',
    EACCES: 'The backend cannot bind its local port.',
  };
  // Do not print arbitrary exception text, environment values, or credentials.
  diagnostic(messages[error.code] || 'Backend startup failed.');
  await shutdown(1);
}
