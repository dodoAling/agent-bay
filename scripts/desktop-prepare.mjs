import { randomUUID } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertRuntimeVersion, exists, filesUnder, GENERATOR, hostTarget, json, managedPath, nodeLicense, portable, productionPackages, PROJECT_ROOT, sha256 } from './desktop-assets.mjs';

export async function prepareDesktopAssets() {
  assertRuntimeVersion(process.versions.node);
  const project = PROJECT_ROOT, bootstrap = join(project, 'desktop/bootstrap.mjs');
  if (!await exists(bootstrap)) throw new Error('desktop/bootstrap.mjs is missing. The desktop backend entry point must exist before preparing resources.');
  const target = await hostTarget(), packages = await productionPackages(project), license = await nodeLicense();
  const authorPackage = await json(join(project, 'package.json'));
  const server = await managedPath(project, 'src-tauri/resources/server');
  const stageRelative = `src-tauri/resources/.server-stage-${randomUUID()}`;
  const stage = await managedPath(project, stageRelative);
  const binaryRelative = `src-tauri/binaries/agent-bay-node-${target}${process.platform === 'win32' ? '.exe' : ''}`;
  const binary = await managedPath(project, binaryRelative);
  const binaryStageRelative = `${binaryRelative}.stage-${randomUUID()}`;
  const binaryStage = await managedPath(project, binaryStageRelative);
  if (await exists(server)) {
    const marker = join(server, 'asset-manifest.json');
    if (!await exists(marker) || (await json(marker)).generator !== GENERATOR) throw new Error(`Refusing to replace an unmarked resource directory: ${server}`);
  }
  await mkdir(stage, { recursive: true });
  try {
    const sourceInputs = [];
    for (const directory of ['src', 'public']) {
      for (const file of await filesUnder(join(project, directory))) sourceInputs.push({ path: `${directory}/${file.name}`, sha256: await sha256(file.path) });
      await cp(join(project, directory), join(stage, directory), { recursive: true });
    }
    await copyFile(bootstrap, join(stage, 'bootstrap.mjs'));
    sourceInputs.push({ path: 'desktop/bootstrap.mjs', sha256: await sha256(bootstrap) });
    for (const source of ['scripts/emit.mjs', 'scripts/mcp-proxy.mjs', 'examples/agent-events.mjs', 'examples/agent_events.py']) {
      const destination = join(stage, source);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(project, source), destination);
      sourceInputs.push({ path: source, sha256: await sha256(join(project, source)) });
    }
    for (const dependency of packages) {
      const destination = join(stage, dependency.relative);
      await mkdir(dirname(destination), { recursive: true });
      await cp(dependency.path, destination, { recursive: true, filter: (source) => source === dependency.path || !portable(source.slice(dependency.path.length + 1)).split('/').includes('node_modules') });
    }
    await mkdir(join(stage, 'licenses'), { recursive: true });
    await copyFile(license, join(stage, 'licenses/NODE-LICENSE.txt'));
    await writeFile(join(stage, 'package.json'), JSON.stringify({ name: `${authorPackage.name}-desktop-server`, version: authorPackage.version, private: true, type: 'module', dependencies: authorPackage.dependencies }, null, 2) + '\n');
    const assets = [];
    for (const file of await filesUnder(stage)) assets.push({ path: file.name, size: (await stat(file.path)).size, sha256: await sha256(file.path) });
    const runtimeHash = await sha256(process.execPath);
    const manifest = { generator: GENERATOR, preparedAt: new Date().toISOString(), target, host: { platform: process.platform, architecture: process.arch },
      runtime: { version: process.versions.node, path: binaryRelative, size: (await stat(process.execPath)).size, sha256: runtimeHash },
      package: { name: authorPackage.name, version: authorPackage.version, sourceSha256: await sha256(join(project, 'package.json')), lockSha256: await sha256(join(project, 'package-lock.json')) },
      dependencies: packages.map(dependency => ({ name: dependency.package.name, version: dependency.package.version, path: dependency.relative })), sourceInputs, assets };
    await writeFile(join(stage, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await mkdir(dirname(binary), { recursive: true });
    if (!await exists(binary) || await sha256(binary) !== runtimeHash) {
      await copyFile(process.execPath, binaryStage);
      if (process.platform !== 'win32') await chmod(binaryStage, 0o755);
      await managedPath(project, binaryStageRelative);
      await managedPath(project, binaryRelative);
      await rename(binaryStage, binary);
    }
    // Recheck absolute targets immediately before recursive replacement.
    await managedPath(project, 'src-tauri/resources/server');
    await managedPath(project, stageRelative);
    await rm(server, { recursive: true, force: true });
    await rename(stage, server);
    return { passed: true, target, runtimeVersion: manifest.runtime.version, runtime: binary, resources: server, productionPackages: packages.length, assets: assets.length,
      crossCompilation: 'The copied runtime belongs to this build host. Build other operating systems or architectures on matching platform runners.' };
  } finally {
    await managedPath(project, stageRelative);
    await managedPath(project, binaryStageRelative);
    await rm(stage, { recursive: true, force: true });
    await rm(binaryStage, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareDesktopAssets().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(`Desktop preparation failed: ${error.message}`); process.exitCode = 1; });
}
