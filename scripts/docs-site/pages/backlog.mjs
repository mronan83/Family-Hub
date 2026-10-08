// Backlog: owner actions first, then milestone progress, the longest remaining chain, the filterable
// status board with full detail per item, the generated dependency map, and sizing.
import { esc, md, mdInline, stripMd } from '../lib/md.mjs';
import { MILESTONES, SIZE_DAYS, STATUS, STATUS_ORDER } from '../lib/model.mjs';
import {
  countBy,
  filterBar,
  icon,
  labelled,
  latestNote,
  pill,
  section,
  shell,
  stack,
  tag,
  tags,
  youPill,
} from '../lib/ui.mjs';

const days = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function traceList(ctx, ids, titleOf) {
  if (!ids.length) return '<span class="none">none</span>';
  return `<ul class="trace-list">${ids
    .map(
      (id) => `<li>${tag(ctx, id)}<span class="t">${mdInline(titleOf(id) || '', ctx)}</span></li>`,
    )
    .join('')}</ul>`;
}

function itemRow(m, ctx, it) {
  const kind = it.kind === 'spike' ? 'Spike' : 'Work package';
  const facts = [
    `<span>${kind} · size ${esc(it.size)}</span>`,
    it.deps.length
      ? `<span>Depends on ${tags(ctx, it.deps)}</span>`
      : '<span>No dependencies</span>',
    it.statusNote ? `<span>${mdInline(it.statusNote, ctx)}</span>` : '',
  ].join('');
  const kv = [
    ['Requirements', traceList(ctx, it.reqs, (id) => m.reqs.get(id)?.text)],
    ['Depends on', tags(ctx, it.deps)],
    it.gatedBy?.length ? ['Gated by', tags(ctx, it.gatedBy)] : null,
    it.gates.length ? ['Gates', tags(ctx, it.gates)] : null,
    ['Unblocks', tags(ctx, it.unblocks)],
    ['Stories', tags(ctx, it.stories)],
    it.waitingOn.length ? ['Waiting on you', tags(ctx, it.waitingOn)] : null,
  ]
    .filter(Boolean)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
  return `<details class="row" id="${it.id.toLowerCase()}" data-item data-f-status="${it.status}" data-f-ms="${it.milestone}" data-f-size="${it.size}" data-f-kind="${it.kind}" data-f-you="${it.waitingOn.join(' ')}">
<summary><span class="id">${it.id}</span><span class="what"><span class="title">${esc(it.fullTitle || it.title)}</span><span class="facts">${facts}</span></span><span class="side">${pill(it.status)}${it.waitingOn.length ? youPill('Needs you') : ''}${icon('chevron-down', 'i chev')}</span></summary>
<div class="row-body">
${it.body.length ? `<ul class="bullets">${it.body.map((b) => `<li>${mdInline(b, ctx)}</li>`).join('')}</ul>` : ''}
${it.doneWhen ? `<p class="done-when"><b>Done when:</b> ${mdInline(it.doneWhen, ctx)}</p>` : ''}
<dl class="kv">${kv}</dl>
</div></details>`;
}

function dependencyMermaid(m) {
  const short = {};
  const docMermaid = m.src.backlog.children.find((c) => c.title.startsWith('3.'))?.md || '';
  for (const x of docMermaid.matchAll(/(WP\d{2})\[WP-\d{2} ([^\]]+)\]/g)) short[x[1]] = x[2];
  const node = (id) => id.replace('-', '');
  const suffix = { done: 'Done', progress: 'In progress', blocked: 'Blocked', ready: 'Ready' };
  const lines = ['flowchart LR'];
  for (const ms of MILESTONES) {
    const ids = [...m.items.values()].filter((it) => it.milestone === ms);
    const name = m.milestones.find((x) => x.id === ms)?.name || '';
    lines.push(`  subgraph ${ms}["${ms} ${name.replace(/"/g, "'")}"]`);
    for (const it of ids) {
      const label = `${it.id} ${short[node(it.id)] || it.title}`
        .replace(/"/g, "'")
        .replace(/`/g, '');
      const st = suffix[it.status] ? `<br/>${suffix[it.status]}` : '';
      lines.push(`    ${node(it.id)}["${label}${st}"]`);
    }
    lines.push('  end');
  }
  for (const it of m.items.values()) {
    for (const d of it.deps) lines.push(`  ${node(d)} --> ${node(it.id)}`);
    for (const g of it.gates) lines.push(`  ${node(it.id)} -.->|gates| ${node(g)}`);
  }
  lines.push(
    '  classDef done fill:#CCFBF1,stroke:#0F766E,color:#115E59',
    '  classDef progress fill:#E0F2FE,stroke:#0369A1,color:#075985,stroke-width:2px',
    '  classDef ready fill:#FFFFFF,stroke:#0F766E,color:#115E59,stroke-dasharray:4 3',
    '  classDef queued fill:#F4EFE6,stroke:#B8AE9C,color:#1F2937',
    '  classDef blocked fill:#F1E8F5,stroke:#7E4F8F,color:#5B3A68',
  );
  for (const st of STATUS_ORDER) {
    const ids = [...m.items.values()].filter((it) => it.status === st).map((it) => node(it.id));
    if (ids.length) lines.push(`  class ${ids.join(',')} ${st}`);
  }
  return lines.join('\n');
}

export function backlog(m, ctx) {
  const items = [...m.items.values()];
  const counts = countBy(items, (i) => i.status);
  const open = (id) => {
    const it = m.items.get(id);
    return [...it.deps, ...(it.gatedBy || [])].filter((d) => m.items.get(d)?.status !== 'done');
  };

  // Waiting on you ------------------------------------------------------------------
  const waiting = `<div class="yours"><p class="small">Only you can do these. Each one names what it unblocks; everything else on this page is Claude Code's, or waits on one of these. Secrets go straight into GitHub or Vercel settings, never into chat.</p><ol>${m.waiting
    .map(
      (y) =>
        `<li id="${y.id.toLowerCase()}"><span class="yid">${y.id}</span><div><div class="act">${mdInline(y.action, ctx)}</div><div class="where">Where: ${mdInline(
          y.where,
          ctx,
        )}</div><div class="unb"><span>Unblocks:</span> ${mdInline(y.unblocks, ctx)}</div></div>${
          y.items.some((i) => m.items.has(i))
            ? `<button type="button" class="btn" data-set-filter="you:${y.id}" data-filter-label="Waiting on ${y.id}">Show on board</button>`
            : ''
        }</li>`,
    )
    .join('')}</ol>${
    m.waitingDone.length
      ? `<details class="yours-done"><summary>Done (${m.waitingDone.length})</summary><ul>${m.waitingDone
          .map(
            (y) =>
              `<li id="${y.id.toLowerCase()}"><span class="yid">${y.id}</span><span>${mdInline(y.outcome, ctx)}</span></li>`,
          )
          .join('')}</ul></details>`
      : ''
  }</div>`;

  // Milestones × size ---------------------------------------------------------------
  const rows = MILESTONES.map((ms) => {
    const its = items.filter((i) => i.milestone === ms);
    const done = its.filter((i) => i.status === 'done').length;
    const msInfo = m.milestones.find((x) => x.id === ms);
    const cell = (size) => {
      const ids = its.filter((i) => i.size === size).map((i) => i.id);
      return `<td>${ids.length ? tags(ctx, ids) : '<span class="none">—</span>'}</td>`;
    };
    const left = its.reduce((s, i) => s + (i.status === 'done' ? 0 : SIZE_DAYS[i.size] || 0), 0);
    return `<tr><th scope="row">${ms} ${esc(msInfo?.name || '')}<small>${its.length} items · ~${days(left)} builder-days left</small><span class="prog">${stack(
      countBy(its, (i) => i.status),
      { small: true, legend: false },
    )}<span>${done} of ${its.length} done</span></span></th>${cell('S')}${cell('M')}${cell('L')}</tr>`;
  }).join('');
  const launchRow = `<tr><th scope="row">Launch<small>after P3, on the real Pi and panel (D-19) · ${m.launch.length} checks, none run yet</small></th><td colspan="3" data-label="Launch checks">${tags(
    ctx,
    m.launch.map((l) => l.id),
  )}</td></tr>`;
  const matrix = `<div class="matrix"><table><thead><tr><th>Milestone</th><th>S · ≤ 2 days</th><th>M · 3–5 days</th><th>L · 1–2 weeks</th></tr></thead><tbody>${rows}${launchRow}</tbody></table></div>
<details class="more"><summary>Exit criteria for each milestone (04 §E)</summary><div class="table-wrap"><table class="md"><thead><tr><th>Milestone</th><th>Exit criteria (CI + preview)</th></tr></thead><tbody>${m.milestones
    .map(
      (x) =>
        `<tr><td data-label="Milestone"><b>${x.id}</b> ${esc(x.name)}</td><td data-label="Exit criteria">${mdInline(x.exit, ctx)}</td></tr>`,
    )
    .join('')}</tbody></table></div></details>`;

  // Longest chain and what starts next --------------------------------------------
  const path = m.critical.path;
  const chain = `<div class="chain">${path
    .map((id, i) => `${i ? `<span class="arrow" aria-hidden="true">→</span>` : ''}${tag(ctx, id)}`)
    .join('')}</div>
<p class="sec-note">${path.length} items, about <b>${days(m.critical.days)} builder-days</b> end to end if each is built one after another. Weights are the midpoints of the size bands (S ${SIZE_DAYS.S}, M ${SIZE_DAYS.M}, L ${SIZE_DAYS.L} days) and finished items count zero. All unfinished work adds up to about ${days(
    m.totalDays,
  )} builder-days; parallel lanes shorten the calendar time, not the total. Sizes are relative effort, not commitments (05 §6).</p>`;
  const nextUp = items.filter(
    (it) =>
      !['done', 'progress'].includes(it.status) &&
      open(it.id).length &&
      open(it.id).every((d) => m.items.get(d).status === 'progress'),
  );
  const startable = items.filter(
    (it) => !['done', 'progress'].includes(it.status) && !open(it.id).length,
  );
  const next = `<div class="split">
<div class="card"><p class="eyebrow">Can start now</p>${
    startable.length
      ? `<ul class="trace-list">${startable
          .map(
            (it) =>
              `<li>${tag(ctx, it.id)}<span class="t">${mdInline(it.fullTitle || it.title, ctx)}${it.waitingOn.length ? ` · waits on ${it.waitingOn.join(', ')}` : ''}${it.status === 'blocked' ? ` · ${esc(stripMd(it.statusNote))}` : ''}</span></li>`,
          )
          .join('')}</ul>`
      : '<p>Nothing: every open item waits on unfinished work.</p>'
  }</div>
<div class="card"><p class="eyebrow">Starts when the work in progress merges</p>${
    nextUp.length
      ? `<ul class="trace-list">${nextUp
          .map(
            (it) =>
              `<li>${tag(ctx, it.id)}<span class="t">${mdInline(it.fullTitle || it.title, ctx)}${it.waitingOn.length ? ` · also needs ${it.waitingOn.join(', ')}` : ''}</span></li>`,
          )
          .join('')}</ul>`
      : '<p>Nothing is waiting only on the work in progress.</p>'
  }</div></div>`;

  // Status board -----------------------------------------------------------------
  const board = MILESTONES.map((ms) => {
    const its = items.filter((i) => i.milestone === ms);
    const msInfo = m.milestones.find((x) => x.id === ms);
    return `<div class="sub" data-group id="ms-${ms.toLowerCase()}"><div class="group-h"><h3>${ms} · ${esc(msInfo?.name || '')}</h3><span class="muted small">${its.length} items</span></div><div class="rows">${its
      .map((it) => itemRow(m, ctx, it))
      .join('\n')}</div></div>`;
  }).join('\n');
  const opt = (facet, values, label = (v) => v, extra = () => ({})) =>
    values.map((v) => ({
      value: v,
      label: label(v),
      count: items.filter((i) => i[facet] === v).length,
      ...extra(v),
    }));
  const bar = filterBar({
    noun: 'items',
    placeholder: 'Search IDs, titles, requirements, done-when…',
    groups: [
      {
        facet: 'status',
        label: 'Status',
        options: opt(
          'status',
          STATUS_ORDER.filter((s) => counts[s]),
          (s) => STATUS[s].label,
          (s) => ({ icon: STATUS[s].icon }),
        ),
      },
      { facet: 'ms', label: 'Milestone', options: opt('milestone', MILESTONES) },
      { facet: 'size', label: 'Size', options: opt('size', ['S', 'M', 'L']) },
      {
        facet: 'kind',
        label: 'Kind',
        options: opt('kind', ['wp', 'spike'], (k) => (k === 'wp' ? 'Work package' : 'Spike')),
      },
    ],
  });

  // Consistency -----------------------------------------------------------------
  const checks = m.checks.filter((c) => m.items.has(c.id));
  const health = `<ul class="checks">${[
    `<li class="ok">${icon('check-circle')} Dependencies point only to the same or an earlier milestone, with no cycles, and the diagram matches every declared dependency (enforced by <code>check_traceability.py</code> in CI).</li>`,
    `<li class="ok">${icon('check-circle')} Every work package traces to at least one requirement and every requirement to at least one work package.</li>`,
    ...checks.map(
      (c) =>
        `<li class="${c.level === 'warn' ? 'warn' : 'muted'}">${icon(c.level === 'warn' ? 'warning' : 'info')} ${tag(ctx, c.id)} ${esc(c.text)}</li>`,
    ),
    !checks.length
      ? `<li class="ok">${icon('check-circle')} Every status on the board agrees with its dependencies.</li>`
      : '',
  ].join('')}</ul>`;

  const body = [
    section('s-0', 'Waiting on you', waiting, { anchors: ['waiting'] }),
    section('track', 'Milestones', labelled(matrix), {
      note: 'Each spike and work package by milestone and size, tinted by status. Phases are build milestones, not releases: one launch after P3 (D-19).',
    }),
    section('critical-path', 'Longest remaining chain', chain + next, {
      note: 'The longest path through dependencies and spike gates, weighted by size. Any slip on it moves the launch.',
    }),
    section(
      's-1',
      'Status board',
      `${bar}<p class="empty" data-empty hidden>No items match. Clear the filters to see all ${items.length}.</p>${board}`,
      {
        anchors: ['s-4', 's-5'],
        note: mdInline(m.statusLegend.replace(/^Statuses:\s*/, ''), ctx),
        tools:
          '<span class="tools"><button type="button" class="btn" data-expand="s-1" aria-pressed="false">Expand all</button></span>',
      },
    ),
    section(
      's-3',
      'Dependency map',
      `<figure class="diagram"><pre class="mermaid">${esc(dependencyMermaid(m))}</pre><figcaption>Generated from each item's Depends on line; dotted arrows are spike gates. Status is written in each box as well as shown by its tint.</figcaption></figure><div class="prose">${md(
        m.depNotes,
        ctx,
      )}</div>`,
    ),
    section(
      's-2',
      'How the work is chunked',
      `<div class="prose">${md(m.chunkingMd, ctx)}<h3 id="prompt">Prompt pattern for a Claude Code session</h3>${md(m.promptMd, ctx)}</div>`,
    ),
    section(
      's-6',
      'Size summary',
      `<div class="prose">${md(m.src.backlog.children.find((c) => c.title.startsWith('6.')).md, ctx)}</div>`,
    ),
    section('consistency', 'Consistency checks', health),
  ].join('\n');

  return shell({
    m,
    ctx,
    page: 'backlog',
    h1: 'Build backlog',
    lede: mdInline(
      `Every spike and work package with its status, what it waits on, and what it unblocks. One branch and one pull request per work package, built in dependency order so nothing finished needs rework. Nothing goes live until P3 is done and the launch checklist passes (D-19).`,
      ctx,
    ),
    stats: [
      { label: 'spikes and work packages', value: items.length },
      { label: 'done', value: counts.done || 0 },
      { label: 'in progress', value: counts.progress || 0 },
      { label: 'blocked', value: counts.blocked || 0 },
      { label: 'waiting on you', value: m.waiting.length, cls: 'st-you' },
      { label: 'builder-days left (size midpoints)', value: `~${Math.round(m.totalDays)}` },
    ],
    latest: latestNote(ctx.docNode),
    toc: [
      { id: 's-0', label: 'Waiting on you' },
      { id: 'track', label: 'Milestones' },
      { id: 'critical-path', label: 'Longest remaining chain' },
      {
        id: 's-1',
        label: 'Status board',
        sub: MILESTONES.map((ms) => ({ id: `ms-${ms.toLowerCase()}`, label: ms })),
      },
      { id: 's-3', label: 'Dependency map' },
      { id: 's-2', label: 'How the work is chunked' },
      { id: 's-6', label: 'Size summary' },
      { id: 'consistency', label: 'Consistency checks' },
    ],
    body,
  });
}
