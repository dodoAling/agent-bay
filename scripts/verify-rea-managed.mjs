import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'artifacts', 'managed-acceptance-fixture');
const dotnet = process.env.AGENT_BAY_DOTNET || 'C:\\Users\\bingb\\scoop\\apps\\dotnet-sdk\\current\\dotnet.exe';
const rea = process.env.AGENT_BAY_REA_SCRIPT || 'D:\\Program Files\\nvm\\v24.11.0\\node_modules\\rea-agents\\scripts\\rea.mjs';
const typeName = 'AgentBay.Acceptance.ManagedFixture';
const source = `namespace AgentBay.Acceptance;

public static class ManagedFixture
{
    public const int ScoreOffset = 37;

    public static int ComputeScore(int input)
    {
        return checked(input * 3 + ScoreOffset);
    }

    public static string Classify(int input)
    {
        int score = ComputeScore(input);
        return score >= 100 ? "REA_ACCEPT_HIGH" : "REA_ACCEPT_LOW";
    }
}
`;

async function save(name, value) { await writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n'); }
await mkdir(join(output, 'offline-packages'), { recursive: true });
await writeFile(join(output, 'Fixture.cs'), source);
await writeFile(join(output, 'Fixture.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><AssemblyName>AgentBay.ManagedAcceptance</AssemblyName><OutputType>Library</OutputType><Optimize>false</Optimize><DebugType>none</DebugType><Deterministic>true</Deterministic><GenerateAssemblyInfo>false</GenerateAssemblyInfo></PropertyGroup></Project>\n`);
await writeFile(join(output, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>\n');
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_NOLOGO: '1' };
const buildLog = [];
for (const args of [['restore', 'Fixture.csproj', '--source', join(output, 'offline-packages'), '--configfile', join(output, 'NuGet.Config')], ['build', 'Fixture.csproj', '--no-restore', '--configuration', 'Release']]) {
  const result = await execFile(dotnet, args, { cwd: output, env, timeout: 60_000, maxBuffer: 8_000_000, windowsHide: true });
  buildLog.push({ command: dotnet, args, stdout: result.stdout, stderr: result.stderr });
}
await save('build-log.json', buildLog);
const artifact = join(output, 'bin', 'Release', 'net10.0', 'AgentBay.ManagedAcceptance.dll');
const artifactBytes = await readFile(artifact);
const identity = { path: artifact, sha256: createHash('sha256').update(artifactBytes).digest('hex'), bytes: artifactBytes.length, sourceSha256: createHash('sha256').update(source).digest('hex'), targetExecuted: false };
await save('identity.json', identity);

const transport = new StdioClientTransport({ command: process.execPath, args: [rea, 'mcp'], cwd: root, stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-100_000); });
const client = new Client({ name: 'agent-bay-managed-acceptance', version: '0.1.0' }, { capabilities: {} });
try {
  await client.connect(transport, { timeout: 30_000 });
  const tools = [];
  let cursor;
  do { const page = await client.listTools(cursor ? { cursor } : {}); tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
  const needed = ['inspect_managed_artifact', 'inspect_managed_members', 'inspect_analysis_view', 'export_evidence_bundle'];
  const schemas = Object.fromEntries(needed.map(name => { const tool = tools.find(t => t.name === name); assert.ok(tool, `REA does not advertise ${name}`); return [name, tool.inputSchema]; }));
  await save('tool-schemas.json', { count: tools.length, schemas });
  if (process.argv.includes('--discover')) {
    console.log(JSON.stringify({ identity, count: tools.length, schemaFile: join(output, 'tool-schemas.json') }, null, 2));
  } else {
    const records = [];
    async function call(name, args, filename) {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
      await save(filename, result);
      assert.ok(!result.isError, `${name} returned an MCP error; see ${filename}`);
      const payload = result.structuredContent || JSON.parse(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
      records.push({ name, args, result: payload });
      return payload;
    }
    const artifactSummary = await call('inspect_managed_artifact', { path: artifact, detail: 'summary' }, '01-artifact-summary.json');
    const memberSummary = await call('inspect_managed_members', { path: artifact, detail: 'summary', type_names: [typeName] }, '02-member-summary.json');
    const views = {};
    const parent = memberSummary.normalized_result.parent_evidence_id;
    for (const [index, collection] of ['methods', 'call_edges', 'user_strings', 'fields'].entries()) {
      views[collection] = await call('inspect_analysis_view', { source: { kind: 'retained-evidence', evidence_id: parent }, view: { kind: 'managed-members', collection, offset: 0, limit: 64 } }, `${String(index + 3).padStart(2, '0')}-${collection}.json`);
    }
    const checks = [];
    function check(name, verify) { verify(); checks.push({ name, status: 'passed' }); }
    const metadata = artifactSummary.normalized_result.summary;
    const members = memberSummary.normalized_result.summary;
    check('REA artifact digest equals compiled DLL digest', () => assert.equal(metadata.artifact.sha256, identity.sha256));
    check('CLI classification is managed CIL', () => { assert.equal(metadata.classification.status, 'managed'); assert.equal(metadata.classification.implementation, 'cil'); });
    check('Framework metadata identifies .NET 10', () => assert.ok(metadata.target_frameworks.includes('.NETCoreApp,Version=v10.0')));
    check('Metadata coverage is complete for this fixture', () => { assert.equal(metadata.metadata.status, 'complete'); assert.equal(metadata.coverage.state, 'complete'); assert.equal(members.coverage.state, 'complete'); });
    check('Requested declaring type is found exactly', () => { assert.deepEqual(members.selection.type_names, [typeName]); assert.deepEqual(members.selection.unmatched_type_names, []); });
    for (const [collection, view] of Object.entries(views)) check(`${collection} page retains artifact identity and reports no next page`, () => { assert.equal(view.normalized_result.artifact.sha256, identity.sha256); assert.equal(view.normalized_result.coverage.exhausted, true); assert.equal(view.normalized_result.coverage.next_offset, null); });
    const rows = name => views[name].normalized_result.page.rows;
    const methods = rows('methods');
    check('Methods recover ComputeScore and Classify', () => assert.deepEqual(methods.map(m => m.name).sort(), ['Classify', 'ComputeScore']));
    const compute = methods.find(m => m.name === 'ComputeScore');
    const classify = methods.find(m => m.name === 'Classify');
    check('Both method bodies decode completely from DLL bytes', () => { for (const method of methods) { assert.equal(method.body.status, 'present'); assert.equal(method.body.truncated_instructions, 0); assert.equal(method.body.instruction_count, method.body.decoded_instruction_count); assert.ok(method.body.il_size > 0); } });
    check('ComputeScore IL contains multiply by 3 and checked arithmetic', () => { assert.equal(compute.body.opcode_counts['ldc.i4.3'], 1); assert.equal(compute.body.opcode_counts['mul.ovf'], 1); assert.equal(compute.body.opcode_counts['add.ovf'], 1); });
    check('ComputeScore IL loads constant 37', () => assert.ok(compute.body.anchors.some(a => a.operand_kind === 'constant' && a.operand === '37')));
    check('Classify IL loads threshold 100 and conditional branch', () => { assert.ok(classify.body.anchors.some(a => a.operand_kind === 'constant' && a.operand === '100')); assert.equal(classify.body.opcode_counts['bge.s'], 1); });
    check('Classify calls ComputeScore with matching build-local method tokens', () => { const edges = rows('call_edges'); assert.equal(edges.length, 1); assert.equal(edges[0].caller, typeName + '.Classify'); assert.equal(edges[0].caller_token, classify.token); assert.equal(edges[0].target_name, 'ComputeScore'); assert.equal(edges[0].target_token, compute.token); });
    check('Both expected user string literals are recovered', () => assert.deepEqual(rows('user_strings').map(s => s.value).sort(), ['REA_ACCEPT_HIGH', 'REA_ACCEPT_LOW']));
    check('Public int ScoreOffset field is recovered', () => { const fields = rows('fields'); assert.equal(fields.length, 1); assert.equal(fields[0].name, 'ScoreOffset'); assert.equal(fields[0].signature.field_type, 'i4'); });
    const bundlePath = join(output, `full-evidence-bundle-${Date.now()}.json`);
    await call('export_evidence_bundle', { path: bundlePath, overwrite: false }, '07-export-result.json');
    const bundleText = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(bundleText);
    function findEvidence(value, id) {
      if (!value || typeof value !== 'object') return null;
      if (value.evidence_id === id && typeof value.operation === 'string') return value;
      for (const child of Object.values(value)) { const found = findEvidence(child, id); if (found) return found; }
      return null;
    }
    check('Export contains complete retained artifact and member Evidence parents', () => {
      for (const [id, operation] of [[artifactSummary.normalized_result.parent_evidence_id, 'inspect_managed_artifact'], [parent, 'inspect_managed_members']]) { const evidence = findEvidence(bundle, id); assert.ok(evidence, `Missing complete retained parent ${id}`); assert.equal(evidence.operation, operation); assert.equal(evidence.subject.digest.sha256, identity.sha256); }
    });
    const report = {
      status: 'passed', verifiedAt: new Date().toISOString(), scope: 'Controlled .NET fixture static REA integration regression; not user-target or model acceptance',
      runtime: { node: process.version, rea: client.getServerVersion(), tools: tools.length }, identity,
      evidenceIds: { artifact: artifactSummary.normalized_result.parent_evidence_id, members: parent, views: Object.fromEntries(Object.entries(views).map(([name, value]) => [name, value.evidence_id])) },
      counts: members.reported_counts, checks,
      bundle: { path: bundlePath, bytes: Buffer.byteLength(bundleText), sha256: createHash('sha256').update(bundleText).digest('hex') },
      limitations: ['No target code was loaded, reflected, or executed.', 'No native decompilation, Hopper, Ghidra, or real model API was tested.', 'The fixture is a known-source controlled integration regression, not a substitute for user-selected software acceptance.', 'Method tokens are valid only within this artifact SHA-256 and MVID.', 'C# source reconstruction is not provided by this static metadata/CIL route.']
    };
    await save('evidence.json', { identity, records });
    await save('report.json', report);
    await writeFile(join(output, 'REPORT.md'), `# REA managed assembly static integration regression\n\nStatus: passed (${checks.length} assertions).\n\nThis controlled .NET 10 fixture was compiled locally to verify actual REA inspection of DLL metadata and CIL. It does not represent acceptance testing of a user application or a real model.\n\n- DLL: \`${artifact}\`\n- SHA-256: \`${identity.sha256}\`\n- MVID: \`${metadata.module.mvid}\`\n- Type: \`${typeName}\`\n- Methods: ComputeScore and Classify; call edge: Classify -> ComputeScore.\n- IL: observed multiplier 3, constant 37, threshold 100, and mul.ovf / add.ovf.\n- Literals: REA_ACCEPT_HIGH and REA_ACCEPT_LOW.\n- REA tool count: ${tools.length}.\n- Complete evidence: [${basename(bundlePath)}](${basename(bundlePath)}); call records: [evidence.json](evidence.json); machine report: [report.json](report.json).\n\n${checks.map(c => `- [x] ${c.name}`).join('\n')}\n\n## Scope\n\nThe target assembly was not loaded, reflected over or executed. Native decompilation, Hopper/Ghidra and a real model were not tested. This fixture was not selected as the final user acceptance target. Inspection covered compiled metadata and CIL; it does not recover original C# source.\n`);
    console.log(JSON.stringify({ status: report.status, checks: checks.length, tools: tools.length, artifactSha256: identity.sha256, methods: methods.map(m => m.name), report: join(output, 'report.json'), bundle: bundlePath, targetExecuted: false }, null, 2));
  }
} finally {
  await client.close();
  await writeFile(join(output, 'rea-stderr.log'), stderr);
}
