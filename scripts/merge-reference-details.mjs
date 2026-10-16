import { readFile, writeFile } from 'node:fs/promises';
const data = JSON.parse(await readFile(new URL('../artifacts/source-lines.json', import.meta.url), 'utf8'));
if (data.states.length !== 744) throw new Error('Expected all 744 measured frames.');
const target = new URL('../public/reference-timeline.js', import.meta.url), marker = '// BEGIN MEASURED FACTORY DETAILS';
let source = (await readFile(target, 'utf8')).split(marker)[0].trimEnd();
source = source.replace('return { ...state, seconds, calloutOpacity,', 'return { ...state, ...REFERENCE_DETAILS[index], seconds, calloutOpacity,');
const rows = data.states.map(s => [s.sourceLines, s.stackTop, s.readerBlue, s.builderBlue, s.gridFlags]);
source += `\n\n${marker}\n// Glyph-measured asm count, decoded stack top, raw border brightness, visible red cell centres.\nconst DETAIL_ROWS = [\n${rows.map(row => '  ' + JSON.stringify(row) + ',').join('\n')}\n];\nexport const REFERENCE_DETAILS = DETAIL_ROWS.map(([sourceLines, stackTop, readerBlue, builderBlue, gridFlags]) => ({ sourceLines, stackTop, readerBlue, builderBlue, gridFlags }));\n`;
await writeFile(target, source);
