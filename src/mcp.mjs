import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { existsSync } from 'node:fs';
import { dirname, join, win32, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export function detectRea({ platform = process.platform, execPath = process.execPath, env = process.env, exists = existsSync, cwd = process.cwd(), projectDir = join(dirname(fileURLToPath(import.meta.url)), '..') } = {}) {
  const paths = platform === 'win32' ? win32 : posix;
  const envValue = name => {
    const key = platform === 'win32' ? Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase()) : name;
    return typeof env[key] === 'string' ? env[key].trim() : '';
  };
  const candidates = new Set();
  const addScript = script => { if (script) candidates.add(paths.resolve(cwd, script)); };
  const addModules = modules => addScript(paths.join(modules, 'rea-agents', 'scripts', 'rea.mjs'));
  const addRoot = root => {
    if (!root) return;
    // npm uses prefix/node_modules on Windows, prefix/lib/node_modules on
    // Unix. Node and executable PATH entries are usually in prefix/bin.
    addModules(paths.join(root, 'node_modules'));
    if (platform !== 'win32') {
      addModules(paths.join(root, 'lib', 'node_modules'));
      addModules(paths.join(root, '..', 'lib', 'node_modules'));
    }
  };
  addScript(envValue('AGENT_BAY_REA_SCRIPT'));
  for (const root of [projectDir, cwd]) if (root) addModules(paths.join(root, 'node_modules'));
  for (const root of [envValue('npm_config_prefix') || envValue('NPM_CONFIG_PREFIX'), envValue('NVM_SYMLINK'), envValue('NVM_BIN'), envValue('HOMEBREW_PREFIX'), paths.dirname(execPath)]) addRoot(root);
  if (platform === 'win32' && envValue('APPDATA')) addRoot(paths.join(envValue('APPDATA'), 'npm'));
  for (const root of envValue('PATH').split(paths.delimiter).filter(Boolean)) addRoot(root);
  for (const script of candidates) {
    if (exists(script)) return { command: execPath, args: [script, 'mcp'] };
  }
  return { command: '', args: ['mcp'] };
}

export class ToolHub {
  constructor(store) { this.store = store; this.servers = new Map(); this.busy = false; }
  summary() {
    return [...this.servers.values()].map(s => ({ id: s.id, name: s.name, status: s.status, tools: s.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, enabled: s.enabled.has(t.name) })) }));
  }
  async connect(config) {
    if (this.busy) throw new Error('Tool connections cannot change while a task is running.');
    if (this.servers.size >= 5) throw new Error('At most 5 MCP servers can be connected.');
    const name = String(config.name || 'MCP').slice(0, 60);
    const id = randomUUID();
    let transport;
    if (config.url) {
      const url = new URL(config.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The MCP URL must use HTTP(S).');
      const headers = config.token ? { Authorization: `Bearer ${config.token}` } : {};
      this.store.rememberSecret(config.token);
      transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    } else {
      if (!config.command || !Array.isArray(config.args) || !config.args.every(v => typeof v === 'string')) throw new Error('Enter an executable path and a JSON array of arguments.');
      const command = process.env.AGENT_BAY_DESKTOP === '1' && /^node(?:\.exe)?$/i.test(config.command) ? process.execPath : config.command;
      transport = new StdioClientTransport({ command, args: config.args, cwd: config.cwd || process.cwd(), stderr: 'pipe' });
      transport.stderr?.on('data', () => {});
    }
    const client = new Client({ name: 'agent-bay', version: '0.1.0' }, { capabilities: {} });
    try {
      await client.connect(transport, { timeout: 30_000 });
      const tools = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools);
        cursor = page.nextCursor;
        if (tools.length > 3000) throw new Error('Tool count exceeds the limit.');
      } while (cursor);
      const preferred = /^(binary_session|open_binary|close_binary|binary_info|list_functions|decompile_function|search_strings|strings|analyze_javascript_application|javascript_session|javascript_read_file|javascript_search|read_file|list_directory)$/;
      const capacity = Math.max(0, 32 - this.selected().length);
      const enabled = new Set(tools.filter(t => preferred.test(t.name)).slice(0, Math.min(16, capacity)).map(t => t.name));
      const server = { id, name, status: 'connected', client, transport, tools, enabled };
      client.onclose = () => { server.status = 'disconnected'; this.store.emit('connections'); };
      this.servers.set(id, server);
      this.store.emit('connections');
      return { id, name, count: tools.length };
    } catch (error) { await client.close().catch(() => {}); throw error; }
  }
  selected() {
    return [...this.servers.values()].filter(s => s.status === 'connected').flatMap(s => s.tools.filter(t => s.enabled.has(t.name)).map(t => ({ ...t, serverId: s.id, serverName: s.name }))).map((t, i) => ({ ...t, alias: `t${i}_${t.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 56)}` }));
  }
  select(serverId, names) {
    if (this.busy) throw new Error('Wait for the current task to finish before changing tools.');
    const server = this.servers.get(serverId);
    if (!server || !Array.isArray(names) || names.some(n => !server.tools.some(t => t.name === n))) throw new Error('Invalid tool selection.');
    const total = [...this.servers.values()].filter(s => s.id !== serverId).reduce((n, s) => n + s.enabled.size, 0) + new Set(names).size;
    if (total > 32) throw new Error('Enable at most 32 tools at a time. Select tools for the task.');
    server.enabled = new Set(names);
    this.store.emit('connections');
  }
  async call(runId, tool, args, signal, callId = randomUUID()) {
    const server = this.servers.get(tool.serverId);
    if (!server || server.status !== 'connected') throw new Error('Tool server is not connected.');
    if (!server.tools.some(t => t.name === tool.name)) throw new Error('Unknown tool.');
    const started = performance.now();
    this.store.push({ runId, type: 'tool.start', callId, name: tool.name, source: server.name, args });
    try {
      const result = await server.client.callTool({ name: tool.name, arguments: args }, undefined, { signal, timeout: 180_000 });
      this.store.push({ runId, type: 'tool.end', callId, name: tool.name, source: server.name, ok: !result.isError, durationMs: Math.round(performance.now() - started), result });
      return result;
    } catch (error) {
      this.store.push({ runId, type: 'tool.end', callId, name: tool.name, source: server.name, ok: false, durationMs: Math.round(performance.now() - started), result: { error: error.message } });
      if (signal?.aborted) throw error;
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  }
  async disconnect(id) {
    if (this.busy) throw new Error('Stop the running task first.');
    const server = this.servers.get(id);
    if (server) { this.servers.delete(id); await server.client.close(); this.store.emit('connections'); }
  }
  async close() { await Promise.allSettled([...this.servers.values()].map(s => s.client.close())); }
}
