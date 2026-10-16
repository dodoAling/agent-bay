import { spawn } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { assertRuntimeVersion, PROJECT_ROOT } from './desktop-assets.mjs';

assertRuntimeVersion(process.version);
const [mode, ...args] = process.argv.slice(2);
if (!['dev', 'build'].includes(mode)) throw new Error('Usage: node scripts/desktop-run.mjs <dev|build> [Tauri options]');
const env = { ...process.env };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
env[pathKey] = `${dirname(process.execPath)}${delimiter}${env[pathKey] || ''}`;
const child = spawn(process.execPath, [join(PROJECT_ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), mode, ...args], {
  cwd: PROJECT_ROOT, env, stdio: 'inherit', windowsHide: false,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(`Desktop command failed: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
