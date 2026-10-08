// Technical architecture: principles, context and container diagrams, components by host, runtime
// flows, security, offline, kiosk, delivery, failure modes, the decision log and open questions, and
// an inventory of what the repository already contains.
import { esc, fullMd, md, mdInline, need } from '../lib/md.mjs';
import { filterBar, ghLink, latestNote, section, shell, tags } from '../lib/ui.mjs';

const HOSTS = ['Pi kiosk', 'Vercel (Next.js)', 'Supabase', 'Cross-cutting'];

export function architecture(m, ctx) {
  const A = m.src.arch;
  const R = m.src.readme;
  const sec = (prefix) => need(A, prefix);
  const prose = (node) => `<div class="prose wide">${md(fullMd(node), ctx)}</div>`;

  const principles = `<ol class="cards plain">${m.principles
    .map(
      (p) =>
        `<li class="card"><span class="num">${p.n}</span><h3>${esc(p.title)}</h3><p>${mdInline(p.text, ctx)}</p></li>`,
    )
    .join('')}</ol>`;

  const components = HOSTS.map((h) => {
    const cs = m.components.filter((c) => c.host === h);
    return `<div class="sub"><div class="group-h"><h3>${esc(h)}</h3><span class="muted small">${cs.length} components</span></div><div class="cards">${cs
      .map(
        (c) =>
          `<article class="card" id="comp-${c.id.toLowerCase()}"><p class="eyebrow"><span class="id">${esc(c.id)}</span></p><h3>${esc(c.name)}</h3><p>${mdInline(c.resp, ctx)}</p><p class="small"><b>Tech.</b> ${mdInline(c.tech, ctx)}</p><p class="small"><b>Primary.</b> ${mdInline(
            c.primary,
            ctx,
          )}</p><details class="more"><summary>${c.reqs.length} requirements trace here</summary>${tags(ctx, c.reqs)}</details></article>`,
      )
      .join('')}</div></div>`;
  }).join('');

  const flows = sec('5.');
  const flowIndex = `<p class="tools">${flows.children
    .map((f) => `<a class="chip" href="#${f.anchor}">${esc(f.title.replace(/\s*\(.*\)$/, ''))}</a>`)
    .join('')}</p>`;

  // Decisions and questions (from 00-README) -----------------------------------------
  const bar = filterBar({
    noun: 'decisions',
    placeholder: 'Search decisions, e.g. offline, ledger, Docker…',
    groups: [],
  });
  const decisions = `${bar}<p class="empty" data-empty hidden>No decisions match.</p><div class="rows" id="decisions-list">${m.decisions
    .map(
      (d) =>
        `<div class="row" id="${d.id.toLowerCase()}" data-item><div class="row-static"><span class="id">${d.id}</span><span class="what"><span class="title long">${mdInline(d.text, ctx)}</span></span><span class="side"></span></div></div>`,
    )
    .join('')}</div>`;
  const questions = `<div class="sub"><h3>Open</h3><div class="cards">${m.openQuestions
    .map(
      (q) =>
        `<div class="card" id="${q.id.toLowerCase()}"><p class="eyebrow"><span class="id">${q.id}</span> · open</p><p>${mdInline(q.text, ctx)}</p><p class="small"><b>Blocks.</b> ${mdInline(q.blocks, ctx)}</p></div>`,
    )
    .join('')}</div></div>
<div class="sub"><h3>Resolved</h3><div class="table-wrap"><table class="md"><thead><tr><th>ID</th><th>Answer</th></tr></thead><tbody>${m.resolved
    .map(
      (q) =>
        `<tr id="${q.id.toLowerCase()}"><td data-label="ID"><span class="id">${q.id}</span></td><td data-label="Answer">${mdInline(q.text, ctx)}</td></tr>`,
    )
    .join('')}</tbody></table></div></div>`;

  const conventions = `<div class="split"><div class="prose"><h3 id="repo-layout">Repository layout</h3>${md(need(R, 'Repo layout').md, ctx)}<h3 id="build-order">Build order</h3>${md(
    need(R, 'Build order').md,
    ctx,
  )}</div><div class="prose"><h3 id="claude-conventions">Conventions for Claude Code</h3>${md(need(R, 'Conventions for Claude Code').md, ctx)}</div></div>`;

  // Inventory from the repository ---------------------------------------------------
  const db = m.db;
  const pgtap = m.tests.filter((t) => t.kind === 'pgTAP').reduce((s, t) => s + t.count, 0);
  const inv = `<div class="split">
<div class="sub"><h3>Routes</h3><div class="table-wrap"><table class="md"><thead><tr><th>Path</th><th>Kind</th><th>Source</th></tr></thead><tbody>${m.routes
    .map(
      (r) =>
        `<tr><td data-label="Path"><code>${esc(r.path)}</code></td><td data-label="Kind">${r.kind}</td><td data-label="Source">${ghLink(m, r.file, r.file.replace('apps/web/app/', ''))}</td></tr>`,
    )
    .join('')}</tbody></table></div></div>
<div class="sub"><h3>Packages</h3><div class="table-wrap"><table class="md"><thead><tr><th>Package</th><th>TS files</th><th>Test files</th></tr></thead><tbody>${m.packages
    .map(
      (p) =>
        `<tr><td data-label="Package"><code>${esc(p.name)}</code><br><span class="muted small">${esc(p.dir)}</span></td><td data-label="TS files">${p.files}</td><td data-label="Test files">${p.tests}</td></tr>`,
    )
    .join('')}</tbody></table></div></div>
</div>
<div class="sub"><h3>Workflows</h3><div class="table-wrap"><table class="md"><thead><tr><th>Workflow</th><th>Runs on</th><th>Jobs</th><th>Purpose</th></tr></thead><tbody>${m.workflows
    .map(
      (w) =>
        `<tr><td data-label="Workflow">${ghLink(m, w.file, w.name)}</td><td data-label="Runs on">${esc(w.triggers.join(', '))}${w.cron ? `<br><code>${esc(w.cron)}</code>` : ''}</td><td data-label="Jobs">${w.jobs
          .map((j) => `<code>${esc(j)}</code>`)
          .join(' → ')}</td><td data-label="Purpose">${mdInline(w.purpose, ctx)}</td></tr>`,
    )
    .join('')}</tbody></table></div></div>
<div class="sub"><h3>Migrations</h3><div class="table-wrap"><table class="md"><thead><tr><th>Migration</th><th>What it does</th><th>Tables</th><th>Functions</th></tr></thead><tbody>${db.migrations
    .map(
      (x) =>
        `<tr><td data-label="Migration">${ghLink(m, x.file, x.file.split('/').pop())}</td><td data-label="What it does">${mdInline(x.title, ctx)}</td><td data-label="Tables">${tags(ctx, x.tables)}</td><td data-label="Functions">${
          x.functions.map((f) => `<code>${esc(f)}</code>`).join(' ') ||
          '<span class="none">none</span>'
        }</td></tr>`,
    )
    .join('')}</tbody></table></div></div>
<div class="sub"><h3>Tests</h3><div class="table-wrap"><table class="md"><thead><tr><th>File</th><th>Runner</th><th>Tests</th><th>Requirements named</th></tr></thead><tbody>${m.tests
    .map(
      (t) =>
        `<tr><td data-label="File">${ghLink(m, t.file)}</td><td data-label="Runner">${t.kind}</td><td data-label="Tests">${t.count}</td><td data-label="Requirements named">${tags(
          ctx,
          [...t.tags].filter((x) => !x.startsWith('US-')).sort(),
        )}</td></tr>`,
    )
    .join('')}</tbody></table></div></div>`;

  const body = [
    section('s-1', 'Architectural principles', principles),
    section('s-2', 'System context', `${md(sec('2.').md, ctx)}`),
    section(
      's-3',
      'Container view',
      `${md(sec('3.').md, ctx)}<p class="sec-note">Component IDs in the boxes are the ones the traceability matrix uses. Select one below for its responsibilities and requirements.</p>`,
    ),
    section('s-4', 'Components', components, {
      note: 'Grouped by where each component runs. Requirement counts come from the component index in 04 §D.',
    }),
    section('s-5', 'Runtime flows', flowIndex + prose(flows)),
    section('s-6', 'Security architecture', prose(sec('6.'))),
    section('s-7', 'Realtime and offline design', prose(sec('7.'))),
    section('s-8', 'Kiosk host', prose(sec('8.'))),
    section('s-9', 'Environments and delivery', prose(sec('9.'))),
    section('s-10', 'Failure modes and degradation', prose(sec('10.'))),
    section('s-11', 'Alternatives considered', prose(sec('11.'))),
    section('decisions', 'Decision log', decisions, {
      note: 'Decisions D-01 to D-29 from the project brief (00-README). Each is binding until a later decision replaces it.',
    }),
    section('questions', 'Questions', questions),
    section('conventions', 'Repository and conventions', conventions),
    section('inventory', 'Built so far', inv, {
      note: `Read from the repository at this commit: ${m.routes.length} routes, ${m.packages.length} packages, ${m.workflows.length} workflows, ${db.migrations.length} migrations creating ${db.tables.size} tables, and ${pgtap} pgTAP assertions.`,
    }),
  ].join('\n');

  return shell({
    m,
    ctx,
    page: 'architecture',
    h1: 'Technical architecture',
    lede: mdInline(
      'A kiosk board and an admin portal on Vercel and Supabase. Apple Calendar stays the system of record for events; chores, rewards, meals and the school year live here. Completions are immutable events and every status is a projection of them, so history is auditable and rebuildable.',
      ctx,
    ),
    stats: [
      { label: 'components', value: m.components.length },
      { label: 'runtime flows', value: flows.children.length },
      { label: 'decisions', value: m.decisions.length },
      { label: 'open questions', value: m.openQuestions.length },
      { label: 'workflows', value: m.workflows.length },
      { label: 'tables built', value: `${db.tables.size} of ${m.entities.size}` },
    ],
    latest: latestNote(ctx.docNode),
    toc: [
      { id: 's-1', label: 'Principles' },
      { id: 's-2', label: 'System context' },
      { id: 's-3', label: 'Container view' },
      { id: 's-4', label: 'Components' },
      {
        id: 's-5',
        label: 'Runtime flows',
        sub: flows.children.map((f) => ({
          id: f.anchor,
          label: f.title.replace(/\s*\(.*\)$/, ''),
        })),
      },
      { id: 's-6', label: 'Security' },
      { id: 's-7', label: 'Realtime and offline' },
      { id: 's-8', label: 'Kiosk host' },
      { id: 's-9', label: 'Environments and delivery' },
      { id: 's-10', label: 'Failure modes' },
      { id: 's-11', label: 'Alternatives considered' },
      { id: 'decisions', label: 'Decision log' },
      { id: 'questions', label: 'Questions' },
      { id: 'conventions', label: 'Repository and conventions' },
      { id: 'inventory', label: 'Built so far' },
    ],
    body,
  });
}
