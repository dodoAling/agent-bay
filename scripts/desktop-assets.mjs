import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GENERATOR = 'agent-bay-desktop-prepare/v1';

export function supportsNode(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major === 22 && minor >= 19 || major === 24 && minor >= 11 || major >= 26;
}

export function assertRuntimeVersion(version) {
  if (!supportsNode(version)) throw new Error(`Unsupported Node.js ${version}. Run desktop preparation with Node.js 22.19+, 24.11+, or 26+; odd 23.x/25.x releases are unsupported by REA.`);
}

export function portable(path) { return path.split(sep).join('/'); }
export async function exists(path) { try { await access(path); return true; } catch { return false; } }
export async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// All removal and replacement paths must be explicit generated paths under this
// repository. Reject junctions/symlinks before filesystem mutations can follow them.
export async function managedPath(projectRoot, expected) {
  if (isAbsolute(expected) || expected.split(/[\\/]/).includes('..')) throw new Error(`Invalid generated asset path: ${expected}`);
  const root = await realpath(projectRoot), path = resolve(root, expected);
  const inside = relative(root, path);
  if (!inside || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`Generated asset path escapes the project: ${path}`);
  let current = root;
  for (const part of inside.split(sep)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing to follow a symlink or junction in generated assets: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path;
}

export async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name), name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Packaged resources cannot contain symlinks: ${path}`);
    if (entry.isDirectory()) files.push(...await filesUnder(path, name));
    else if (entry.isFile()) files.push({ name, path });
    else throw new Error(`Unsupported packaged resource type: ${path}`);
  }
  return files;
}

export async function command(executable, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, { cwd: PROJECT_ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Command timed out: ${executable} ${args.join(' ')}`)); }, 30_000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolveCommand(stdout.trim());
      else reject(new Error(`${executable} exited with ${code}: ${(stderr || stdout).trim().slice(0, 2000)}`));
    });
  });
}

export async function hostTarget() {
  const output = await command('rustc', ['-vV']);
  const host = output.match(/^host:\s*(\S+)/m)?.[1];
  if (!host || !/^[a-z\d_]+(?:-[a-z\d_]+)+$/i.test(host)) throw new Error('Could not determine the Rust host target from rustc -vV.');
  const requested = process.env.CARGO_BUILD_TARGET || process.env.TAURI_ENV_TARGET_TRIPLE || host;
  if (requested !== host) throw new Error(`Desktop resources include the host Node.js runtime (${host}). Build ${requested} on a matching platform runner instead of copying this runtime across platforms.`);
  const architecture = { x64: 'x86_64-', arm64: 'aarch64-', ia32: 'i686-', arm: 'armv7-' }[process.arch];
  const platformMatches = process.platform === 'win32' ? host.includes('-windows-') : process.platform === 'darwin' ? host.endsWith('-apple-darwin') : process.platform === 'linux' && host.includes('-linux-');
  if (!architecture || !host.startsWith(architecture) || !platformMatches) throw new Error(`Node.js ${process.platform}/${process.arch} does not match the Rust build host ${host}. Use the matching Node.js runtime on this runner.`);
  return host;
}

export async function productionPackages(projectRoot) {
  const runtime = await realpath(process.execPath);
  const candidates = [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    join(dirname(runtime), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(runtime), '../lib/node_modules/npm/bin/npm-cli.js'),
    '/usr/share/nodejs/npm/bin/npm-cli.js', '/usr/local/lib/node_modules/npm/bin/npm-cli.js'].filter(Boolean);
  let npm;
  for (const candidate of candidates) if (await exists(candidate)) { npm = candidate; break; }
  if (!npm) throw new Error('npm-cli.js was not found beside Node.js. Install npm on this build runner or run this script through npm.');
  const output = await command(process.execPath, [npm, 'ls', '--prefix', projectRoot, '--omit=dev', '--all', '--parseable'], { env: { ...process.env, NO_COLOR: '1' } });
  const root = await realpath(projectRoot), modules = join(root, 'node_modules'), packages = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const path = resolve(line);
    if (path === root) continue;
    const actual = await realpath(path), name = relative(modules, actual);
    if (!name || name.startsWith(`..${sep}`) || isAbsolute(name)) throw new Error(`Production dependency resolves outside project node_modules: ${path}`);
    packages.push({ path: actual, relative: portable(relative(root, actual)), package: await json(join(actual, 'package.json')) });
  }
  if (!packages.length) throw new Error('No production dependencies were found. Run npm ci before preparing the desktop assets.');
  return [...new Map(packages.map(item => [item.relative, item])).values()].sort((a, b) => a.relative.localeCompare(b.relative));
}

export async function nodeLicense() {
  const runtime = await realpath(process.execPath);
  const candidates = [process.env.AGENT_BAY_NODE_LICENSE, join(dirname(runtime), 'LICENSE'),
    join(dirname(runtime), '../LICENSE'), join(dirname(runtime), '../share/doc/node/LICENSE'), '/usr/share/doc/nodejs/copyright'].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('The bundled Node.js license was not found. Set AGENT_BAY_NODE_LICENSE to the LICENSE from this Node.js distribution.');
}
