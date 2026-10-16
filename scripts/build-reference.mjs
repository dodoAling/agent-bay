import { readFile, writeFile } from 'node:fs/promises';

// Keep the existing public entry points compatible with an already running
// buildless server. Author the reference renderer/data in their own modules.
const base = new URL('../public/', import.meta.url);
for (const [entry, source, imported] of [
  ['factory-view.js', 'reference-factory.js', "import { drawReferenceFactory } from './reference-factory.js';"],
  ['demo-scenarios.js', 'reference-timeline.js', "import { REFERENCE_STATES, REFERENCE_DURATION_MS } from './reference-timeline.js';"]
]) {
  const target = new URL(entry, base), marker = '// BEGIN GENERATED REFERENCE MODULE';
  const current = (await readFile(target, 'utf8')).split(marker)[0].replace(imported + '\n', '').trimEnd();
  const module = (await readFile(new URL(source, base), 'utf8')).trimEnd();
  await writeFile(target, `${current}\n\n${marker}\n// Source: ${source}. Update with npm run build:reference.\n${module}\n`);
}
