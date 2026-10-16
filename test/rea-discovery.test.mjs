import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRea } from '../src/mcp.mjs';

function discover({ platform = 'linux', execPath = '/usr/bin/node', env = {}, cwd = '/workspace/project', projectDir = cwd, scripts = [] } = {}) {
  const checked = [], available = new Set(scripts);
  const result = detectRea({ platform, execPath, env, cwd, projectDir, exists(script) { checked.push(script); return available.has(script); } });
  return { result, checked };
}

test('explicit REA script wins and remains a literal argument without a shell', () => {
  const explicit = '/opt/REA tools/a;$(touch never-run)/rea.mjs';
  const local = '/workspace/project/node_modules/rea-agents/scripts/rea.mjs';
  const { result, checked } = discover({ env: { AGENT_BAY_REA_SCRIPT: explicit }, scripts: [explicit, local] });
  assert.deepEqual(result, { command: '/usr/bin/node', args: [explicit, 'mcp'] });
  assert.deepEqual(checked, [explicit]);
});

test('project-local install is found even when service starts outside the project', () => {
  const script = '/opt/agent-bay/node_modules/rea-agents/scripts/rea.mjs';
  const { result } = discover({ cwd: '/home/user', projectDir: '/opt/agent-bay', scripts: [script] });
  assert.deepEqual(result.args, [script, 'mcp']);
});

test('macOS Homebrew prefix and executable PATH locate Unix global installation', () => {
  const script = '/opt/homebrew/lib/node_modules/rea-agents/scripts/rea.mjs';
  for (const env of [{ HOMEBREW_PREFIX: '/opt/homebrew' }, { PATH: '/opt/homebrew/bin:/usr/bin:/bin' }]) {
    const { result } = discover({ platform: 'darwin', execPath: '/opt/homebrew/Cellar/node/24.11.0/bin/node', env, scripts: [script] });
    assert.deepEqual(result, { command: '/opt/homebrew/Cellar/node/24.11.0/bin/node', args: [script, 'mcp'] });
  }
});

test('macOS /usr/local Node resolves the adjacent lib/node_modules directory', () => {
  const script = '/usr/local/lib/node_modules/rea-agents/scripts/rea.mjs';
  const { result } = discover({ platform: 'darwin', execPath: '/usr/local/bin/node', scripts: [script] });
  assert.deepEqual(result.args, [script, 'mcp']);
});

test('Linux system and PATH global npm prefixes both work', () => {
  for (const script of ['/usr/lib/node_modules/rea-agents/scripts/rea.mjs', '/usr/local/lib/node_modules/rea-agents/scripts/rea.mjs']) {
    const { result } = discover({ env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, scripts: [script] });
    assert.deepEqual(result.args, [script, 'mcp']);
  }
});

test('Linux nvm and custom npm prefixes are found without executing npm', () => {
  const nvm = '/home/user/.nvm/versions/node/v24.11.0';
  const script = `${nvm}/lib/node_modules/rea-agents/scripts/rea.mjs`;
  assert.deepEqual(discover({ env: { NVM_BIN: `${nvm}/bin` }, scripts: [script] }).result.args, [script, 'mcp']);
  for (const key of ['npm_config_prefix', 'NPM_CONFIG_PREFIX']) {
    const custom = '/home/user/npm global/lib/node_modules/rea-agents/scripts/rea.mjs';
    assert.deepEqual(discover({ env: { [key]: '/home/user/npm global' }, scripts: [custom] }).result.args, [custom, 'mcp']);
  }
});

test('Windows Node, NVM_SYMLINK and APPDATA installs retain their existing layout', () => {
  const execPath = 'D:\\Node\\node.exe';
  const cases = [
    [{}, 'D:\\Node\\node_modules\\rea-agents\\scripts\\rea.mjs'],
    [{ NVM_SYMLINK: 'D:\\ProgramData\\nodejs' }, 'D:\\ProgramData\\nodejs\\node_modules\\rea-agents\\scripts\\rea.mjs'],
    [{ APPDATA: 'C:\\Users\\User\\AppData\\Roaming' }, 'C:\\Users\\User\\AppData\\Roaming\\npm\\node_modules\\rea-agents\\scripts\\rea.mjs'],
    [{ Path: 'D:\\Extra Tools;C:\\Windows' }, 'D:\\Extra Tools\\node_modules\\rea-agents\\scripts\\rea.mjs']
  ];
  for (const [env, script] of cases) {
    const { result } = discover({ platform: 'win32', execPath, cwd: 'D:\\workspace', env, scripts: [script] });
    assert.deepEqual(result, { command: execPath, args: [script, 'mcp'] });
  }
});

test('missing installation returns unavailable and repeated paths are checked once', () => {
  const { result, checked } = discover({ env: { NVM_BIN: '/usr/bin', PATH: '/usr/bin:/usr/bin:/bin', AGENT_BAY_REA_SCRIPT: '/missing/rea.mjs' } });
  assert.deepEqual(result, { command: '', args: ['mcp'] });
  assert.equal(checked.length, new Set(checked).size);
  assert.ok(checked.includes('/missing/rea.mjs'));
});
