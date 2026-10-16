// Workspace language runtime. English text doubles as the message id; the
// Chinese table lives in i18n-zh.tsv so the English-source check and every
// build step keep working. Modules that get inlined into app.js,
// factory-view.js, or demo-scenarios.js must not import this file — they read
// globalThis.agentBayT / agentBayTf / agentBayLang instead, which also keeps
// Node-based unit tests on English fallbacks.

let current = 'en';
let zh = {};

const parseTable = source => {
  const table = {};
  const unescape = value => value.replace(/\\(n|t|\\)/g, (_, c) => c === 'n' ? '\n' : c === 't' ? '\t' : '\\');
  for (const line of String(source || '').split(/\r?\n/)) {
    if (!line || (line.startsWith('#') && !line.includes('\t'))) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    table[unescape(line.slice(0, tab))] = unescape(line.slice(tab + 1));
  }
  return table;
};

if (typeof document !== 'undefined') {
  try { current = localStorage.getItem('agent-bay.lang'); } catch {}
  if (current !== 'en' && current !== 'zh') current = 'en';
  try {
    const response = await fetch(new URL('./i18n-zh.tsv', import.meta.url));
    if (response.ok) zh = parseTable(await response.text());
  } catch {}
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
}

export function lang() { return current; }
export function t(msgid) { return current === 'zh' ? zh[msgid] ?? msgid : msgid; }
export function tf(msgid, params = {}) {
  let text = t(msgid);
  for (const [key, value] of Object.entries(params)) text = text.replaceAll(`{${key}}`, value);
  return text;
}

const ATTRS = ['placeholder', 'aria-label', 'title'];
const reverse = () => Object.fromEntries(Object.entries(zh).map(([en, value]) => [value, en]));
const swap = (text, table) => {
  const match = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
  const hit = table[match[2]];
  return hit === undefined ? text : match[1] + hit + match[3];
};

export function applyDom(root = document) {
  if (typeof document === 'undefined') return;
  const table = current === 'zh' ? zh : reverse();
  const scope = root === document ? document.documentElement : root;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  for (let node; node = walker.nextNode();) node.textContent = swap(node.textContent, table);
  for (const element of scope.querySelectorAll('*')) {
    for (const attr of ATTRS) {
      if (!element.hasAttribute(attr)) continue;
      const next = swap(element.getAttribute(attr), table);
      if (next !== element.getAttribute(attr)) element.setAttribute(attr, next);
    }
  }
}

export function setLang(next) {
  const value = next === 'zh' ? 'zh' : 'en';
  if (value === current) return;
  current = value;
  try { localStorage.setItem('agent-bay.lang', current); } catch {}
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
  applyDom(document);
  document.dispatchEvent(new CustomEvent('agentbay:lang'));
}

globalThis.agentBayT = t;
globalThis.agentBayTf = tf;
globalThis.agentBayLang = lang;
