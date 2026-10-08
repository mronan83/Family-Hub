#!/usr/bin/env node
// Builds the five interactive build-artifact pages (Architecture, Data model, Requirements, Stories,
// Backlog) from docs/01–05 and the repository. Published copies live at the URLs in artifacts.json.
//
//   pnpm docs:build            write dist/docs-site/*.html
//   pnpm docs:build --check    also fail on broken cross-links or unknown IDs (CI)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripMd } from './lib/md.mjs';
import { loadModel } from './lib/model.mjs';
import { PAGES } from './lib/ui.mjs';
import { architecture } from './pages/architecture.mjs';
import { backlog } from './pages/backlog.mjs';
import { dataModel } from './pages/data-model.mjs';
import { requirements } from './pages/requirements.mjs';
import { stories } from './pages/stories.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const outDir = resolve(
  root,
  args.find((a) => a.startsWith('--out='))?.slice(6) || 'dist/docs-site',
);
const urls = JSON.parse(readFileSync(join(here, 'artifacts.json'), 'utf8'));

const RENDER = { architecture, 'data-model': dataModel, requirements, stories, backlog };
const DOC = {
  architecture: ['01', 'arch'],
  'data-model': ['02', 'data'],
  requirements: ['04', 'reqs'],
  stories: ['03', 'stories'],
  backlog: ['05', 'backlog'],
};

const clip = (s, n = 240) => {
  const t = stripMd(s).replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

function buildIndex(m) {
  const idx = new Map();
  const add = (id, page, anchor, title, status, kind) =>
    idx.set(id, { page, anchor, title: clip(title), status, kind });
  for (const q of m.reqs.values())
    add(q.id, 'requirements', q.id.toLowerCase(), q.text, q.status, 'Requirement');
  for (const s of m.stories.values())
    add(s.id, 'stories', s.id.toLowerCase(), s.title, s.status, 'User story');
  for (const it of m.items.values()) {
    add(
      it.id,
      'backlog',
      it.id.toLowerCase(),
      it.fullTitle || it.title,
      it.status,
      it.kind === 'spike' ? 'Spike' : 'Work package',
    );
  }
  for (const d of m.decisions)
    add(d.id, 'architecture', d.id.toLowerCase(), d.text, '', 'Decision');
  for (const o of m.resolved)
    add(o.id, 'architecture', o.id.toLowerCase(), o.text, '', 'Resolved question');
  for (const o of m.openQuestions)
    add(o.id, 'architecture', o.id.toLowerCase(), o.text, '', 'Open question');
  for (const r of m.risks) add(r.id, 'requirements', r.id.toLowerCase(), r.risk, '', 'Risk');
  for (const a of m.assumptions)
    add(a.id, 'requirements', a.id.toLowerCase(), a.text, '', 'Assumption');
  for (const l of m.launch)
    add(l.id, 'requirements', l.id.toLowerCase(), l.check, '', 'Launch check');
  for (const y of m.waiting)
    add(y.id, 'backlog', y.id.toLowerCase(), y.action, '', 'Waiting on you');
  for (const y of m.waitingDone)
    add(y.id, 'backlog', y.id.toLowerCase(), y.outcome, 'done', 'Owner setup · done');
  for (const c of m.components)
    add(
      c.id,
      'architecture',
      `comp-${c.id.toLowerCase()}`,
      `${c.name}: ${c.resp}`,
      '',
      'Component',
    );
  for (const e of m.entities.values()) {
    add(
      e.name,
      'data-model',
      `t-${e.name}`,
      e.notes || e.keyCols,
      e.built ? 'done' : '',
      e.built ? 'Table · built' : 'Table · specified',
    );
  }
  return idx;
}

const m = loadModel(root);
const index = buildIndex(m);
const tableNames = new Set(m.entities.keys());
const componentIds = new Set(m.components.map((c) => c.id));

const raw = {};
const problems = [];
const unknown = new Map();
for (const p of PAGES) {
  const [doc, key] = DOC[p.key];
  const ctx = {
    index,
    unknown: new Set(),
    tables: tableNames,
    components: componentIds,
    doc,
    docNode: m.src[key],
  };
  raw[p.key] = RENDER[p.key](m, ctx);
  for (const id of ctx.unknown) unknown.set(id, [...(unknown.get(id) || []), p.key]);
}

// Every cross-link must land on an element that exists.
const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]));
const anchors = Object.fromEntries(Object.entries(raw).map(([k, html]) => [k, idsOf(html)]));
for (const [k, html] of Object.entries(raw)) {
  const dup = [...html.matchAll(/\sid="([^"]+)"/g)]
    .map((x) => x[1])
    .filter((id, i, a) => a.indexOf(id) !== i);
  for (const id of new Set(dup)) problems.push(`${k}: duplicate id "${id}"`);
  for (const [, page, anchor] of html.matchAll(/href="xref:([a-z-]+)#([^"]*)"/g)) {
    if (!anchors[page]) problems.push(`${k}: link to unknown page "${page}"`);
    else if (!anchors[page].has(anchor))
      problems.push(`${k}: link to ${page}#${anchor}, which does not exist`);
  }
  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) {
    if (!anchors[k].has(anchor)) problems.push(`${k}: link to #${anchor}, which does not exist`);
  }
}
for (const [id, pages] of unknown)
  problems.push(`unknown ID ${id} referenced on ${[...new Set(pages)].join(', ')}`);

mkdirSync(outDir, { recursive: true });
for (const [k, html] of Object.entries(raw)) {
  const out = html.replace(/href="xref:([a-z-]+)#([^"]*)"/g, (x, page, anchor) => {
    if (page === k) return `href="#${anchor}"`;
    if (urls[page]) return `href="${urls[page]}#${anchor}" target="_blank" rel="noopener"`;
    return `href="${page}.html#${anchor}"`;
  });
  writeFileSync(join(outDir, `${k}.html`), out);
  console.log(`${k}.html  ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`);
}
const missingUrls = PAGES.filter((p) => !urls[p.key]).map((p) => p.key);
if (missingUrls.length)
  console.log(
    `note: no published URL yet for ${missingUrls.join(', ')} (artifacts.json); cross-page links are relative`,
  );

for (const p of problems) console.log(`${check ? 'ERROR' : 'WARN '} ${p}`);
console.log(`${problems.length} problem(s) · written to ${outDir}`);
if (check && problems.length) process.exit(1);
