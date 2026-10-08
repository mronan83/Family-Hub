// One model of the build docs (00–05) joined with what the repository contains. Pages render from it;
// nothing here is hand-maintained, so the pages cannot drift from the markdown.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bullets, need, parseDoc, records, slug, stripMd, table } from './md.mjs';
import {
  gitInfo,
  scanMigrations,
  scanPackages,
  scanRoutes,
  scanTests,
  scanWorkflows,
} from './repo.mjs';

export const REPO_URL = 'https://github.com/mronan83/Family-Hub';
export const MILESTONES = ['P0', 'P1a', 'P1b', 'P1c', 'P1d', 'P2', 'P3'];
export const STATUS_ORDER = ['done', 'progress', 'ready', 'queued', 'blocked'];
export const STATUS = {
  done: { label: 'Done', icon: 'check-circle' },
  progress: { label: 'In progress', icon: 'sync' },
  ready: { label: 'Ready', icon: 'circle' },
  queued: { label: 'Queued', icon: 'hourglass' },
  blocked: { label: 'Blocked', icon: 'lock' },
};
// Midpoints of the size bands in 05 §2 (S ≤ 2 days, M 3–5, L 1–2 weeks), in builder-days.
export const SIZE_DAYS = { S: 1.5, M: 4, L: 7.5 };

const REQ_RX =
  /\b(ACC|DEV|CHR|RWD|CAL|SCH|MEAL|MENU|BRD|PTS|NFR)-(\d{2})(?:\.\.(\d{2})|((?:\/\d{2})+))?/g;
const ITEM_RX = /\b(WP-\d{2}|SPIKE-\d{2}|L-\d{2})\b/g;
const ids = (s, rx) => [...new Set([...String(s).matchAll(rx)].map((m) => m[1]))];

export function expandReqs(text) {
  const out = [];
  for (const m of String(text).matchAll(REQ_RX)) {
    const a = Number(m[2]);
    const b = m[3] ? Number(m[3]) : a;
    for (let n = a; n <= b; n++) out.push(`${m[1]}-${String(n).padStart(2, '0')}`);
    for (const n of (m[4] || '').split('/').filter(Boolean)) out.push(`${m[1]}-${n}`);
  }
  return [...new Set(out)];
}

const list = (cell) =>
  stripMd(cell)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== '—');

function parseStatus(cell) {
  const m = cell.trim().match(/^(Done|In progress|Ready|Queued|Blocked)\b\s*:?\s*(.*)$/i);
  if (!m) return { status: 'queued', note: cell };
  const key = {
    done: 'done',
    'in progress': 'progress',
    ready: 'ready',
    queued: 'queued',
    blocked: 'blocked',
  };
  return { status: key[m[1].toLowerCase()], note: m[2].replace(/^\((.*)\)$/, '$1').trim() };
}

export function rollup(statuses) {
  if (!statuses.length) return 'queued';
  if (statuses.every((s) => s === 'done')) return 'done';
  if (statuses.some((s) => s === 'done' || s === 'progress')) return 'progress';
  const open = statuses.filter((s) => s !== 'done');
  if (open.every((s) => s === 'blocked')) return 'blocked';
  return open.some((s) => s === 'ready') ? 'ready' : 'queued';
}

// "**Phase:** P0 · **Size:** M · **Depends on:** — · **Reqs:** ..." -> { phase, size, ... }
function metaLine(md) {
  const line = md.split('\n').find((l) => /^\*\*[A-Z][a-z ]+:\*\*/.test(l)) || '';
  const out = {};
  for (const part of line.split(' · ')) {
    const m = part.match(/^\*\*([^*]+):\*\*\s*(.*)$/);
    if (m) out[slug(m[1])] = m[2].trim();
  }
  return out;
}

// ---------------------------------------------------------------------------

export function loadModel(root) {
  const read = (f) => readFileSync(join(root, 'docs', f), 'utf8');
  const src = {
    readme: parseDoc(read('00-README.md')),
    arch: parseDoc(read('01-technical-architecture.md')),
    data: parseDoc(read('02-data-model.md')),
    stories: parseDoc(read('03-user-stories.md')),
    reqs: parseDoc(read('04-requirements-traceability.md')),
    backlog: parseDoc(read('05-backlog.md')),
  };
  const m = { src, git: gitInfo(root) };

  // 00 — decisions and questions ------------------------------------------------
  m.decisions = records(table(need(src.readme, 'Key decisions').md)).map((r) => ({
    id: r.id,
    text: r.decision,
  }));
  m.resolved = records(table(need(src.readme, 'Resolved questions').md)).map((r) => ({
    id: r.id,
    text: r.answer,
  }));
  m.openQuestions = records(table(need(src.readme, 'Open questions').md)).map((r) => ({
    id: r.id,
    text: r.question,
    blocks: r.blocks,
  }));

  // 04 — requirements and everything traced to them ------------------------------
  const R = src.reqs;
  const scheme = R.md.split('\n').find((l) => l.startsWith('**ID scheme:**')) || '';
  m.domains = [...scheme.matchAll(/`([A-Z]+)` ([A-Za-z/ -]+?)(?= ·|\.$)/g)].map((x) => ({
    code: x[1],
    name: x[2],
  }));
  const verLine = R.md.split('\n').find((l) => l.startsWith('**Verification:**')) || '';
  m.verification = Object.fromEntries(
    [...verLine.matchAll(/`([A-Z0-9]+)` ([^·]+)/g)].map((x) => [
      x[1],
      x[2].trim().replace(/\.$/, ''),
    ]),
  );
  m.verification.CI = 'CI gates';
  m.reqs = new Map();
  for (const r of records(table(need(R, 'A.').md))) {
    m.reqs.set(r.id, {
      id: r.id,
      text: r.requirement,
      pri: r.pri,
      phase: r.phase,
      source: r.source,
      domain: r.id.split('-')[0],
      stories: [],
      wps: [],
      comps: [],
      entities: [],
      verify: [],
      tests: [],
    });
  }
  for (const r of records(table(need(R, 'B.').md))) {
    const q = m.reqs.get(r.req);
    if (!q) continue;
    q.stories = list(r.stories);
    q.wps = list(r['work-packages']);
    q.comps = list(r.components);
    q.entities = list(r['data-entities']).filter((e) => /^[a-z_.]+$/.test(e));
    q.entityNote = list(r['data-entities']).filter((e) => !/^[a-z_.]+$/.test(e));
    q.verify = list(r.verification);
  }
  m.coverageMd = need(R, 'C.').md;
  m.componentIndex = records(table(need(R, 'D.').md)).map((r) => ({
    id: stripMd(r.component),
    reqs: list(r.requirements),
  }));
  const E = need(R, 'E.');
  m.milestoneIntro = E.md.split('\n\n')[0];
  m.milestones = records(table(E.md)).map((r) => {
    const [id, ...name] = stripMd(r.milestone).split(' ');
    return { id, name: name.join(' '), scope: r.scope, exit: r['exit-criteria-ci-preview'] };
  });
  m.launch = table(need(E, 'Launch acceptance').md).rows.map((c) => ({
    id: c[0],
    check: c[1],
    source: c[2],
  }));
  m.verificationMd = need(R, 'F.').md;
  const G = need(R, 'G.');
  m.risks = records(table(need(G, 'Risks').md));
  m.spikeQuestions = records(table(need(G, 'Spikes').md));
  m.assumptions = records(table(need(G, 'Assumptions').md)).map((r) => ({
    id: r.id,
    text: r.assumption,
  }));
  m.maintainingMd = need(R, 'H.').md;
  m.changelog = records(table(need(R, 'I.').md));

  // 03 — stories ---------------------------------------------------------------
  m.personas = records(table(need(src.stories, 'Personas').md)).map((r) => ({
    id: stripMd(r.id),
    name: r.persona,
    text: r.description,
  }));
  m.epics = [];
  m.stories = new Map();
  for (const e of src.stories.children.filter((c) => /^E\d+ — /.test(c.title))) {
    const [eid, etitle] = e.title.split(' — ');
    const epic = { id: eid, title: etitle, stories: [] };
    for (const s of e.children.filter((c) => /^US-\d+ — /.test(c.title))) {
      const [id, title] = s.title.split(' — ');
      const lines = s.md.split('\n');
      const asLine = lines.find((l) => l.startsWith('**As a')) || '';
      const meta = metaLine(s.md);
      const who = (asLine.match(/^\*\*As an?\*\* (\w+)/) || [])[1] || '';
      const story = {
        id,
        title,
        epic: eid,
        as: asLine,
        persona: who === 'parent' ? 'admin' : who,
        priority: meta.priority,
        phase: meta.phase,
        reqs: expandReqs(meta.reqs || ''),
        criteria: bullets(s.md),
      };
      epic.stories.push(id);
      m.stories.set(id, story);
    }
    m.epics.push(epic);
  }

  // 05 — backlog ---------------------------------------------------------------
  const B = src.backlog;
  m.waiting = records(table(need(B, '0.').md)).map((r) => ({
    id: r.item,
    action: r.action,
    where: r.where,
    unblocks: r.unblocks,
    items: ids(r.unblocks, ITEM_RX),
  }));
  m.statusLegend =
    need(B, '1.')
      .md.split('\n')
      .find((l) => l.startsWith('Statuses:')) || '';
  m.items = new Map();
  for (const r of records(table(need(B, '1.').md))) {
    const st = parseStatus(r.status);
    m.items.set(r.item, {
      id: r.item,
      kind: r.item.startsWith('SPIKE') ? 'spike' : 'wp',
      title: r.title,
      milestone: r.milestone,
      size: r.size,
      deps: ids(r['depends-on'], /\b(WP-\d{2}|SPIKE-\d{2})\b/g),
      status: st.status,
      statusNote: st.note,
      gates: [],
      reqs: [],
      body: [],
      doneWhen: '',
      waitingOn: [],
    });
  }
  const detail = (node) => {
    const id = node.title.split(' — ')[0];
    const it = m.items.get(id);
    if (!it) return;
    const meta = metaLine(node.md);
    it.fullTitle = node.title.split(' — ')[1];
    it.reqs = expandReqs(meta.reqs || '');
    it.gates = ids(meta.gates || '', /\b(WP-\d{2})\b/g);
    const bl = bullets(node.md);
    it.body = bl.filter((b) => !b.startsWith('**Done when:**'));
    it.doneWhen = (bl.find((b) => b.startsWith('**Done when:**')) || '')
      .replace('**Done when:**', '')
      .trim();
  };
  need(B, '4.').children.forEach(detail);
  need(B, '5.').children.forEach(detail);
  m.chunkingMd = need(B, '2.').md;
  m.promptMd = need(B, 'Prompt pattern').md;
  const dep = need(B, '3.');
  m.depNotes = dep.md.replace(/```mermaid[\s\S]*?```/, '').trim();
  m.sizeSummary = records(table(need(B, '6.').md));
  m.sizeNote = need(B, '6.')
    .md.split('\n')
    .filter((l) => l && !l.startsWith('|'))
    .join(' ');

  for (const y of m.waiting) for (const i of y.items) m.items.get(i)?.waitingOn.push(y.id);
  for (const it of m.items.values()) it.unblocks = [];
  for (const it of m.items.values()) {
    for (const d of it.deps) m.items.get(d)?.unblocks.push(it.id);
    for (const g of it.gates) {
      const w = m.items.get(g);
      if (w && !w.deps.includes(it.id)) w.gatedBy = [...(w.gatedBy || []), it.id];
    }
  }

  // 01 — architecture ------------------------------------------------------------
  const A = src.arch;
  m.principles = need(A, '1.')
    .md.split('\n')
    .filter((l) => /^\d+\. /.test(l))
    .map((l) => {
      const x = l.match(/^(\d+)\. \*\*(.+?)\*\*\s*(.*)$/);
      return { n: x[1], title: x[2].replace(/\.$/, ''), text: x[3] };
    });
  m.components = records(table(need(A, '4.').md)).map((r) => ({
    id: stripMd(r.id),
    name: r.component,
    resp: r.responsibility,
    tech: r.tech,
    primary: r['primary-requirements'],
  }));
  const host = {};
  for (const [h, ids2] of Object.entries({
    'Pi kiosk': ['PI', 'BRD', 'OUTBOX'],
    'Vercel (Next.js)': ['ADM', 'API', 'AUTH', 'RULES', 'OCCGEN', 'CALSYNC', 'MENUIMP'],
    Supabase: ['DB', 'RT', 'VAULT', 'SAUTH', 'SCHED'],
    'Cross-cutting': ['OBS', 'UI', 'CICD'],
  })) {
    for (const id of ids2) host[id] = h;
  }
  for (const c of m.components) {
    c.host = host[c.id] || 'Cross-cutting';
    c.reqs = m.componentIndex.find((x) => x.id === c.id)?.reqs || [];
  }

  // 02 — data model ------------------------------------------------------------
  const D = src.data;
  m.erds = need(D, '2.').children.map((c) => ({ title: c.title, anchor: c.anchor, md: c.md }));
  m.catalog = need(D, '3.').children.map((c) => {
    const lines = c.md.split('\n');
    const start = lines.findIndex((l) => l.startsWith('|'));
    let end = start;
    while (end < lines.length && lines[end].startsWith('|')) end++;
    return {
      title: c.title.replace(/^[0-9.]+[a-z]?\s+/, ''),
      anchor: c.anchor,
      intro: lines.slice(0, start).join('\n').trim(),
      extra: lines.slice(end).join('\n').trim(),
      tables: table(c.md).rows.map((r) => ({ name: stripMd(r[0]), keyCols: r[1], notes: r[2] })),
    };
  });
  m.entityMap = records(table(need(D, '7.').md)).map((r) => ({
    entities: [...r.entity.matchAll(/`([a-z_.]+)`/g)].map((x) => x[1]),
    raw: r.entity,
    reqs: expandReqs(r.requirements),
    reqText: r.requirements,
  }));

  // Repository ------------------------------------------------------------------
  m.tests = scanTests(root);
  m.db = scanMigrations(root);
  m.routes = scanRoutes(root);
  m.packages = scanPackages(root);
  m.workflows = scanWorkflows(root);

  derive(m);
  return m;
}

// ---------------------------------------------------------------------------
// Derived views: statuses, trace in both directions, critical path, checks
// ---------------------------------------------------------------------------

function derive(m) {
  const itemStatus = (id) => m.items.get(id)?.status || 'queued';

  for (const q of m.reqs.values()) q.status = rollup(q.wps.map(itemStatus));
  for (const s of m.stories.values()) {
    s.wps = [...new Set(s.reqs.flatMap((r) => m.reqs.get(r)?.wps || []))];
    s.status = rollup(s.wps.map(itemStatus));
  }
  for (const it of m.items.values()) {
    it.stories = [...new Set(it.reqs.flatMap((r) => m.reqs.get(r)?.stories || []))];
  }

  // Tests by requirement or story ID.
  for (const t of m.tests) {
    for (const c of t.cases) {
      for (const id of c.ids)
        m.reqs.get(id)?.tests.push({ file: t.file, kind: t.kind, line: c.line, name: c.name });
    }
    for (const id of t.tags) {
      const q = m.reqs.get(id);
      if (q && !q.tests.some((x) => x.file === t.file))
        q.tests.push({ file: t.file, kind: t.kind, line: 1, name: '' });
    }
  }

  // Entities: catalog rows joined with what the migrations built and what traces to them.
  m.entities = new Map();
  for (const dom of m.catalog) {
    for (const t of dom.tables) {
      const built = m.db.tables.get(t.name) || null;
      m.entities.set(t.name, {
        ...t,
        domain: dom.title,
        domainAnchor: dom.anchor,
        built,
        reqs: [],
        wps: [],
      });
    }
  }
  for (const q of m.reqs.values()) {
    q.entityNote = [...q.entityNote, ...q.entities.filter((e) => !m.entities.has(e))];
    q.entities = q.entities.filter((e) => m.entities.has(e));
    for (const e of q.entities) m.entities.get(e).reqs.push(q.id);
  }
  for (const row of m.entityMap) {
    for (const e of row.entities) {
      const ent = m.entities.get(e);
      if (ent) ent.reqs = [...new Set([...ent.reqs, ...row.reqs])];
    }
  }
  for (const ent of m.entities.values()) {
    ent.reqs.sort();
    const rx = new RegExp('`' + ent.name.replace('.', '\\.') + '`');
    ent.wps = [...m.items.values()]
      .filter((it) => it.body.some((b) => rx.test(b)))
      .map((it) => it.id);
  }

  // Longest remaining chain: dependencies plus spike gates, weighted by size; finished items weigh 0.
  const preds = (id) => [...(m.items.get(id)?.deps || []), ...(m.items.get(id)?.gatedBy || [])];
  const memo = new Map();
  const longest = (id) => {
    if (memo.has(id)) return memo.get(id);
    const it = m.items.get(id);
    const w = it.status === 'done' ? 0 : SIZE_DAYS[it.size] || 0;
    let best = { days: 0, path: [] };
    for (const p of preds(id)) {
      const r = longest(p);
      if (r.days > best.days) best = r;
    }
    const out = { days: best.days + w, path: [...best.path, id] };
    memo.set(id, out);
    return out;
  };
  m.critical = [...m.items.keys()].map(longest).sort((a, b) => b.days - a.days)[0];
  m.totalDays = [...m.items.values()].reduce(
    (s, it) => s + (it.status === 'done' ? 0 : SIZE_DAYS[it.size] || 0),
    0,
  );

  // Consistency checks surfaced on the pages.
  m.checks = [];
  for (const it of m.items.values()) {
    const open = preds(it.id).filter((d) => itemStatus(d) !== 'done');
    if (it.status === 'queued' && !open.length && !it.waitingOn.length) {
      m.checks.push({
        level: 'info',
        id: it.id,
        text: 'every dependency is done; the board could say Ready',
      });
    }
    if (it.status === 'ready' && open.length) {
      m.checks.push({
        level: 'warn',
        id: it.id,
        text: `marked Ready but waits on ${open.join(', ')}`,
      });
    }
  }
  for (const t of m.db.tables.values()) {
    const key = t.schema === 'public' ? t.name : `${t.schema}.${t.name}`;
    if (!m.entities.has(key))
      m.checks.push({ level: 'warn', id: key, text: 'built but missing from the 02 §3 catalog' });
    if (t.schema === 'public' && !t.rls)
      m.checks.push({ level: 'warn', id: key, text: 'public table without RLS' });
  }
}
