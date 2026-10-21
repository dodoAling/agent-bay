import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const includeArtifacts = process.argv.includes('--artifacts');
const excluded = new Set(['.git', 'node_modules', '__pycache__', 'bin', 'obj', 'README.zh-CN.md']);
const generated = new Set(['src-tauri/target', 'src-tauri/gen', 'src-tauri/resources/server', 'src-tauri/binaries']);
if (!includeArtifacts) excluded.add('artifacts');
const extensions = new Set(['.md', '.js', '.mjs', '.json', '.html', '.css', '.py', '.ps1', '.cmd', '.txt', '.log', '.cs', '.csproj', '.rs', '.toml']);
const ideographs = /[\u3400-\u9fff\uf900-\ufaff]/u;
const failures = [];
let checked = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    const name = relative(root, path).replaceAll('\\', '/');
    if (generated.has(name) || name.startsWith('src-tauri/resources/.server-stage-')) continue;
    if (entry.isDirectory()) { await walk(path); continue; }
    if (!entry.isFile() || !extensions.has(extname(entry.name))) continue;
    const bytes = await readFile(path);
    const source = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8').replace(/^\uFEFF/, '');
    checked++;
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (ideographs.test(line)) failures.push({ file: relative(root, path).replaceAll('\\', '/'), line: index + 1, text: line.trim().slice(0, 180) });
    }
  }
}

await walk(root);
if (failures.length) {
  for (const entry of failures.slice(0, 60)) console.error(`${entry.file}:${entry.line}: ${entry.text}`);
  console.error(`${failures.length} non-English lines found in ${checked} text files.`);
  process.exitCode = 1;
} else console.log(`English text check passed for ${checked} files.`);
