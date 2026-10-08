// Requirements and traceability: build status by domain and phase, the register joined with the matrix
// and tagged tests, coverage, components, milestones and launch checks, risks, spikes, change log.
import { esc, md, mdInline } from '../lib/md.mjs';
import { STATUS, STATUS_ORDER } from '../lib/model.mjs';
import {
  countBy,
  filterBar,
  ghLink,
  icon,
  meter,
  pill,
  section,
  shell,
  stack,
  tag,
  tags,
} from '../lib/ui.mjs';

const PRI = { M: 'Must', S: 'Should', C: 'Could' };
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function reqRow(m, ctx, q) {
  const trace = (ids, title) =>
    ids.length
      ? `<ul class="trace-list">${ids.map((id) => `<li>${tag(ctx, id)}<span class="t">${esc(title(id) || '')}</span></li>`).join('')}</ul>`
      : '<span class="none">none</span>';
  const tests = q.tests.length
    ? `<ul class="trace-list">${q.tests
        .map(
          (t) =>
            `<li><span class="pill st-done">${icon('check')}${esc(t.kind)}</span>${ghLink(m, t.file, `${t.file.split('/').pop()}${t.name ? `:${t.line}` : ''}`, t.name ? t.line : 0)}<span class="t">${esc(
              t.name || 'file-level tag',
            )}</span></li>`,
        )
        .join('')}</ul>`
    : `<span class="none">No tagged test yet. Tests carry <code>[${q.id}]</code> in their name.</span>`;
  const verify = q.verify
    .map(
      (v) =>
        `<span class="tag" title="${esc(m.verification[v] || v)}">${esc(v)}</span> <span class="muted small">${esc(m.verification[v] || '')}</span>`,
    )
    .join(' · ');
  const kv = [
    ['Stories', trace(q.stories, (id) => m.stories.get(id)?.title)],
    ['Work packages', trace(q.wps, (id) => m.items.get(id)?.title)],
    [
      'Components',
      tags(
        ctx,
        q.comps.filter((c) => c !== 'all'),
      ) +
        (q.comps.includes('all')
          ? ' <span class="muted small">applies to every component</span>'
          : ''),
    ],
    [
      'Tables',
      (q.entities.length ? tags(ctx, q.entities) : '') +
        (q.entityNote.length
          ? ` <span class="muted small">${esc(q.entityNote.join(', '))}</span>`
          : q.entities.length
            ? ''
            : '<span class="none">none</span>'),
    ],
    ['Verified by', verify || '<span class="none">—</span>'],
    ['Tagged tests', tests],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
  const facts = [
    `<span>${PRI[q.pri] || q.pri} · ${esc(q.phase)} · ${esc(q.source)}</span>`,
    `<span>${plural(q.stories.length, 'story', 'stories')}</span>`,
    `<span>${plural(q.wps.length, 'work package')}</span>`,
    `<span>${q.tests.length ? plural(q.tests.length, 'tagged test') : 'no tests yet'}</span>`,
  ].join('');
  return `<details class="row" id="${q.id.toLowerCase()}" data-item data-f-domain="${q.domain}" data-f-pri="${q.pri}" data-f-phase="${q.phase}" data-f-status="${q.status}" data-f-tested="${q.tests.length ? 'yes' : 'no'}">
<summary><span class="id">${q.id}</span><span class="what"><span class="title long">${mdInline(q.text, ctx)}</span><span class="facts">${facts}</span></span><span class="side">${pill(q.status)}${icon('chevron-down', 'i chev')}</span></summary>
<div class="row-body"><dl class="kv">${kv}</dl></div></details>`;
}

export function requirements(m, ctx) {
  const reqs = [...m.reqs.values()];
  const counts = countBy(reqs, (q) => q.status);
  const pri = countBy(reqs, (q) => q.pri);
  const tested = reqs.filter((q) => q.tests.length).length;
  const domainName = Object.fromEntries(m.domains.map((d) => [d.code, d.name]));

  // Build status ------------------------------------------------------------------
  const domainRows = m.domains
    .map((d) => {
      const rs = reqs.filter((q) => q.domain === d.code);
      const p = countBy(rs, (q) => q.pri);
      return `<tr><th scope="row"><button type="button" class="btn" data-set-filter="domain:${d.code}" data-filter-label="${esc(d.code)}">${d.code}</button> <span class="muted small">${esc(d.name)}</span></th><td>${rs.length}</td><td style="min-width:200px">${stack(countBy(rs, (q) => q.status))}</td><td>${['M', 'S', 'C'].map((k) => p[k] || 0).join(' / ')}</td><td>${rs.filter((q) => q.tests.length).length}</td></tr>`;
    })
    .join('');
  const phaseRows = ['P0', 'P1', 'P2', 'P3']
    .map((ph) => {
      const rs = reqs.filter((q) => q.phase === ph);
      return `<tr><th scope="row"><button type="button" class="btn" data-set-filter="phase:${ph}" data-filter-label="${ph}">${ph}</button></th><td>${rs.length}</td><td style="min-width:200px">${stack(countBy(rs, (q) => q.status))}</td><td>${rs.filter((q) => q.tests.length).length}</td></tr>`;
    })
    .join('');
  const buildStatus = `<div class="matrix"><table><thead><tr><th>Domain</th><th>Reqs</th><th>Status</th><th>Must / Should / Could</th><th>Tested</th></tr></thead><tbody>${domainRows}</tbody></table></div>
<div class="matrix"><table><thead><tr><th>Phase</th><th>Reqs</th><th>Status</th><th>Tested</th></tr></thead><tbody>${phaseRows}</tbody></table></div>`;

  const model = `<figure class="diagram"><pre class="mermaid">${esc(`flowchart LR
  US["User story (03)<br/>${m.stories.size} stories"] -->|"Reqs: line"| REQ["Requirement (04 §A)<br/>${reqs.length} requirements"]
  WP["Spike or work package (05)<br/>${m.items.size} items"] -->|"Reqs: line"| REQ
  WP -->|"status board"| ST["Status<br/>rolls up to the requirement"]
  REQ -->|"matrix 04 §B"| COMP["Component (01 §4)<br/>${m.components.length} components"]
  REQ -->|"matrix 04 §B"| ENT["Table (02 §3)<br/>${m.entities.size} tables"]
  TEST["Test named [REQ-ID]<br/>${m.tests.reduce((s, t) => s + t.count, 0)} tests in ${m.tests.length} files"] -->|"proves"| REQ`)}</pre><figcaption><code>check_traceability.py</code> runs in CI: every requirement needs a story and a work package, and the Stories and Work packages columns of the matrix are generated from the <code>Reqs:</code> lines, never edited by hand.</figcaption></figure>`;

  // Register ------------------------------------------------------------------------
  const bar = filterBar({
    noun: 'requirements',
    placeholder: 'Search IDs, wording, stories, tables, tests…',
    groups: [
      {
        facet: 'domain',
        label: 'Domain',
        options: m.domains.map((d) => ({
          value: d.code,
          label: d.code,
          count: reqs.filter((q) => q.domain === d.code).length,
        })),
      },
      {
        facet: 'pri',
        label: 'Priority',
        options: ['M', 'S', 'C'].map((k) => ({ value: k, label: PRI[k], count: pri[k] || 0 })),
      },
      {
        facet: 'phase',
        label: 'Phase',
        options: ['P0', 'P1', 'P2', 'P3'].map((p) => ({
          value: p,
          label: p,
          count: reqs.filter((q) => q.phase === p).length,
        })),
      },
      {
        facet: 'status',
        label: 'Status',
        options: STATUS_ORDER.filter((s) => counts[s]).map((s) => ({
          value: s,
          label: STATUS[s].label,
          icon: STATUS[s].icon,
          count: counts[s],
        })),
      },
      {
        facet: 'tested',
        label: 'Tests',
        options: [
          { value: 'yes', label: 'Has tests', count: tested },
          { value: 'no', label: 'None yet', count: reqs.length - tested },
        ],
      },
    ],
  });
  const register = m.domains
    .map((d) => {
      const rs = reqs.filter((q) => q.domain === d.code);
      return `<div class="sub" data-group id="dom-${d.code.toLowerCase()}"><div class="group-h"><h3>${d.code} · ${esc(d.name)}</h3><span class="muted small">${rs.length} requirements</span></div><div class="rows">${rs
        .map((q) => reqRow(m, ctx, q))
        .join('\n')}</div></div>`;
    })
    .join('\n');

  // Coverage ------------------------------------------------------------------------
  const coverage = `<div class="prose">${md(m.coverageMd, ctx)}</div>
<div class="cards">${['P0', 'P1', 'P2', 'P3']
    .map((ph) => {
      const rs = reqs.filter((q) => q.phase === ph);
      const t = rs.filter((q) => q.tests.length).length;
      return `<div class="card"><p class="eyebrow">${ph} · tagged tests</p><p><b>${t} of ${rs.length}</b> requirements have at least one test naming them.</p>${meter(t, rs.length)}</div>`;
    })
    .join('')}</div>`;

  // Components ----------------------------------------------------------------------
  const comps = `<div class="table-wrap"><table class="md"><thead><tr><th>Component</th><th>Name</th><th>Requirements</th></tr></thead><tbody>${m.components
    .map(
      (c) =>
        `<tr><td data-label="Component">${tag(ctx, c.id)}</td><td data-label="Name">${esc(c.name)}</td><td data-label="Requirements"><details class="more"><summary>${c.reqs.length} requirements</summary>${tags(ctx, c.reqs)}</details></td></tr>`,
    )
    .join(
      '',
    )}</tbody></table></div><p class="sec-note">NFR-12 applies to every component. Generated by <code>check_traceability.py --fix</code>.</p>`;

  // Milestones and launch -----------------------------------------------------------
  const items = [...m.items.values()];
  const milestones = `<p class="sec-note">${mdInline(m.milestoneIntro, ctx)}</p><div class="cards">${m.milestones
    .map((x) => {
      const its = items.filter((i) => i.milestone === x.id);
      const done = its.filter((i) => i.status === 'done').length;
      return `<div class="card" id="m-${x.id.toLowerCase()}"><p class="eyebrow">${x.id} · ${its.length} items</p><h3>${esc(x.name)}</h3>${meter(done, its.length)}<span class="stack-l">${done} of ${its.length} done</span><p><b>Scope.</b> ${mdInline(x.scope, ctx)}</p><p><b>Exit criteria.</b> ${mdInline(x.exit, ctx)}</p>${tags(
        ctx,
        its.map((i) => i.id),
      )}</div>`;
    })
    .join('')}</div>
<div class="sub" id="launch"><h3>Launch acceptance</h3><p class="sec-note">Run once, on the real Pi and panel, after P3. Every check must pass before launch.</p><div class="rows">${m.launch
    .map(
      (l) =>
        `<div class="row" id="${l.id.toLowerCase()}"><div class="row-static"><span class="id">${l.id}</span><span class="what"><span class="title long">${mdInline(l.check, ctx)}</span><span class="facts"><span>${mdInline(l.source, ctx)}</span></span></span><span class="side">${pill('queued', 'Not run')}</span></div></div>`,
    )
    .join('')}</div></div>`;

  // Risks ---------------------------------------------------------------------------
  const lvl = { Low: 1, Med: 2, High: 3 };
  const grid = ['High', 'Med', 'Low']
    .map(
      (l) =>
        `<div class="ax">${l}</div>${['Low', 'Med', 'High']
          .map((i) => {
            const rs = m.risks.filter((r) => r.likelihood === l && r.impact === i);
            const heat = lvl[l] * lvl[i] >= 6 ? 'h3' : lvl[l] * lvl[i] >= 3 ? 'h2' : '';
            return `<div class="cell ${heat}" aria-label="Likelihood ${l}, impact ${i}: ${rs.length} risks">${rs.map((r) => tag(ctx, r.id)).join('')}</div>`;
          })
          .join('')}`,
    )
    .join('');
  const risks = `<div class="riskgrid" role="group" aria-label="Risks by likelihood and impact"><div></div><div class="ax top">Impact low</div><div class="ax top">Impact med</div><div class="ax top">Impact high</div>${grid}</div>
<p class="sec-note">Rows are likelihood, columns impact. Hover a risk for its wording.</p>
<div class="table-wrap"><table class="md"><thead><tr><th>ID</th><th>Risk</th><th>Likelihood</th><th>Impact</th><th>Mitigation</th></tr></thead><tbody>${m.risks
    .map(
      (r) =>
        `<tr id="${r.id.toLowerCase()}"><td data-label="ID"><span class="id">${r.id}</span></td><td data-label="Risk">${mdInline(r.risk, ctx)}</td><td data-label="Likelihood">${esc(r.likelihood)}</td><td data-label="Impact">${esc(r.impact)}</td><td data-label="Mitigation">${mdInline(r.mitigation, ctx)}</td></tr>`,
    )
    .join('')}</tbody></table></div>
<div class="sub" id="spikes"><h3>Spikes</h3><div class="table-wrap"><table class="md"><thead><tr><th>Spike</th><th>Question</th><th>Unblocks</th></tr></thead><tbody>${m.spikeQuestions
    .map(
      (s) =>
        `<tr><td data-label="Spike">${tag(ctx, s.id)}</td><td data-label="Question">${mdInline(s.question, ctx)}</td><td data-label="Unblocks">${mdInline(s.unblocks, ctx)}</td></tr>`,
    )
    .join('')}</tbody></table></div></div>
<div class="sub" id="assumptions"><h3>Assumptions</h3><div class="table-wrap"><table class="md"><thead><tr><th>ID</th><th>Assumption</th></tr></thead><tbody>${m.assumptions
    .map(
      (a) =>
        `<tr id="${a.id.toLowerCase()}"><td data-label="ID"><span class="id">${a.id}</span></td><td data-label="Assumption">${mdInline(a.text, ctx)}</td></tr>`,
    )
    .join('')}</tbody></table></div></div>`;

  const changelog = `<div class="table-wrap"><table class="md"><thead><tr><th>Version</th><th>Changes</th></tr></thead><tbody>${m.changelog
    .map(
      (c) =>
        `<tr><td data-label="Version"><span class="id">${esc(c.version)}</span></td><td data-label="Changes">${mdInline(c.changes, ctx)}</td></tr>`,
    )
    .join('')}</tbody></table></div>`;

  const body = [
    section('build-status', 'Build status', buildStatus, {
      note: 'Requirements by domain and phase, by the status of the work packages that build them. Select a domain or phase to filter the register.',
    }),
    section('trace-model', 'How the trace works', model),
    section(
      's-a',
      'Requirements register and trace',
      `${bar}<p class="empty" data-empty hidden>No requirements match. Clear the filters to see all ${reqs.length}.</p>${register}`,
      {
        anchors: ['s-b'],
        note: 'The register (04 §A) joined with the traceability matrix (04 §B) and the tests that name each requirement. Open a row for its stories, work packages, components, tables and tests.',
        tools:
          '<span class="tools"><button type="button" class="btn" data-expand="s-a" aria-pressed="false">Expand all</button></span>',
      },
    ),
    section('s-c', 'Coverage', coverage),
    section('s-d', 'Component index', comps),
    section('s-e', 'Milestones and launch', milestones),
    section(
      's-f',
      'Verification conventions',
      `<div class="prose">${md(m.verificationMd, ctx)}</div>`,
    ),
    section('s-g', 'Risks, spikes, assumptions', risks),
    section(
      's-h',
      'Maintaining traceability',
      `<div class="prose">${md(m.maintainingMd, ctx)}</div>`,
    ),
    section('s-i', 'Change log', changelog),
  ].join('\n');

  const latest = m.changelog[0];
  return shell({
    m,
    ctx,
    page: 'requirements',
    h1: 'Requirements and traceability',
    lede: `The source of truth for requirement IDs. Each requirement links to the stories that describe it, the work packages that build it, the components and tables it touches, and the tests that prove it. Status rolls up from the backlog.`,
    stats: [
      { label: 'requirements', value: reqs.length },
      { label: 'Must', value: pri.M || 0 },
      { label: 'in progress', value: counts.progress || 0 },
      { label: 'done', value: counts.done || 0 },
      { label: 'with tagged tests', value: tested },
      { label: 'risks', value: m.risks.length },
    ],
    latest: latest ? { version: `v${latest.version}`, text: latest.changes } : null,
    toc: [
      { id: 'build-status', label: 'Build status' },
      { id: 'trace-model', label: 'How the trace works' },
      {
        id: 's-a',
        label: 'Register and trace',
        sub: m.domains.map((d) => ({
          id: `dom-${d.code.toLowerCase()}`,
          label: `${d.code} ${domainName[d.code]}`,
        })),
      },
      { id: 's-c', label: 'Coverage' },
      { id: 's-d', label: 'Component index' },
      { id: 's-e', label: 'Milestones and launch' },
      { id: 's-f', label: 'Verification conventions' },
      { id: 's-g', label: 'Risks, spikes, assumptions' },
      { id: 's-h', label: 'Maintaining traceability' },
      { id: 's-i', label: 'Change log' },
    ],
    body,
  });
}
