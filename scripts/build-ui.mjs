import { readFile, writeFile } from 'node:fs/promises';
import { pixelAgentSvg } from '../public/pixel-agent.js';

// Bundle the pure result reader into the existing static entry point so an
// already running buildless server can pick up this UI with a normal refresh.
const app = new URL('../public/app.js', import.meta.url);
const begin = '// BEGIN GENERATED RESULT VIEW', end = '// END GENERATED RESULT VIEW';
let source = await readFile(app, 'utf8');
if (source.startsWith(begin)) {
  const endIndex = source.indexOf(end);
  if (endIndex < 0) throw new Error('Generated result view is missing its END marker; app.js was left unchanged.');
  source = source.slice(endIndex + end.length).trimStart();
}
const reader = await readFile(new URL('../public/result-view.js', import.meta.url), 'utf8');
const htmlFile = new URL('../public/index.html', import.meta.url);
const html = await readFile(htmlFile, 'utf8');
const iconBegin = '<!-- BEGIN SHARED PIXEL AGENT -->', iconEnd = '<!-- END SHARED PIXEL AGENT -->';
const iconStart = html.indexOf(iconBegin), iconStop = html.indexOf(iconEnd, iconStart + iconBegin.length);
if (iconStart < 0 || iconStop < 0) throw new Error('Shared pixel agent markers are missing; UI files were left unchanged.');
await writeFile(app, `${begin}\n// Source: result-view.js. Update with npm run build:ui.\n${reader}\n${end}\n\n${source}`);
await writeFile(htmlFile, html.slice(0, iconStart + iconBegin.length) + pixelAgentSvg() + html.slice(iconStop));
