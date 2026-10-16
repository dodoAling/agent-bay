import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'public/vendor');
await mkdir(join(vendor, 'licenses'), { recursive: true });
const result = await build({
  stdin: { contents: "export { default as html2canvas } from 'html2canvas'; export { Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource, canEncodeVideo, QUALITY_HIGH } from 'mediabunny';", resolveDir: root, sourcefile: 'demo-export-vendor-entry.js' },
  outfile: join(vendor, 'demo-export-vendor.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, charset: 'ascii', legalComments: 'inline', metafile: true,
  banner: { js: '// Generated with npm run build:video. Third-party licenses are in ./licenses/.' },
});
const packages = [...new Set(Object.keys(result.metafile.inputs).filter(path => path.startsWith('node_modules/')).map(path => {
  const parts = path.slice('node_modules/'.length).split('/'); return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}))];
const licenses = [];
const included = new Set(packages);
for (const name of packages) {
  const metadata = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  // html2canvas ships a prebundled entry; retain licenses for its embedded
  // dependency closure as well as packages visible in esbuild's input graph.
  for (const dependency of Object.keys(metadata.dependencies || {})) {
    if (dependency.startsWith('@types/') || included.has(dependency)) continue;
    included.add(dependency); packages.push(dependency);
  }
  let copied = false;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENSE-MIT']) {
    try { await copyFile(join(root, 'node_modules', name, filename), join(vendor, 'licenses', name.replaceAll('/', '-') + '.txt')); copied = true; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!copied) throw new Error(`License file missing for bundled package: ${name}`);
  licenses.push({ name, version: metadata.version, license: metadata.license });
}
await writeFile(join(vendor, 'licenses/packages.json'), JSON.stringify(licenses, null, 2) + '\n');
console.log(`Browser video dependencies bundled with ${licenses.length} license files.`);
