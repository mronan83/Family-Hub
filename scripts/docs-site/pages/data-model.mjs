// Data model: conventions, ERDs, the table catalog joined with what the migrations actually built
// (columns, RLS, policies, triggers, realtime), key DDL, the rules-engine contract, lifecycle, the
// entity → requirement map, and catalog health checks.
import { esc, fullMd, md, mdInline, need } from '../lib/md.mjs';
import {
  filterBar,
  ghLink,
  icon,
  latestNote,
  pill,
  section,
  shell,
  tag,
  tags,
} from '../lib/ui.mjs';

function columnsTable(t) {
  const rows = t.columns
    .map((c) => {
      const notes = [
        c.pk ? 'primary key' : '',
        c.ref ? `→ <code>${esc(c.ref)}</code>` : '',
        c.unique ? 'unique' : '',
        c.check ? `check <code>${esc(c.check)}</code>` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<tr><td data-label="Column"><code>${esc(c.name)}</code></td><td data-label="Type"><code>${esc(c.type)}</code></td><td data-label="Null">${c.notNull ? 'not null' : '<span class="muted">null</span>'}</td><td data-label="Default">${
        c.default ? `<code>${esc(c.default)}</code>` : ''
      }</td><td data-label="Notes">${notes}</td></tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table class="md"><thead><tr><th>Column</th><th>Type</th><th>Null</th><th>Default</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tableRow(m, ctx, e, domainKey) {
  const b = e.built;
  const reqTrace = e.reqs.length
    ? `<ul class="trace-list">${e.reqs.map((r) => `<li>${tag(ctx, r)}<span class="t">${esc(m.reqs.get(r)?.text || '')}</span></li>`).join('')}</ul>`
    : '<span class="none">not mapped to a requirement</span>';
  const builtDetail = b
    ? `<dl class="kv">
<dt>Migration</dt><dd>${ghLink(m, b.file, b.file.split('/').pop())}</dd>
<dt>Row level security</dt><dd>${
        b.schema !== 'public'
          ? `Not exposed: lives in the <code>${esc(b.schema)}</code> schema, outside the API.`
          : b.rls
            ? `${icon('shield-check')} enabled`
            : `${icon('warning')} not enabled`
      }</dd>
${
  b.policies.length
    ? `<dt>Policies</dt><dd><ul class="trace-list">${b.policies
        .map(
          (p) =>
            `<li><code>${esc(p.name)}</code><span class="t">${esc(p.cmd)} · ${esc(p.roles)}</span></li>`,
        )
        .join('')}</ul></dd>`
    : ''
}
${b.triggers.length ? `<dt>Triggers</dt><dd>${b.triggers.map((t) => `<code>${esc(t.name)}</code> <span class="muted small">${esc(t.when)}</span>`).join('<br>')}</dd>` : ''}
${b.constraints.length ? `<dt>Constraints</dt><dd>${b.constraints.map((c) => `<code>${esc(c)}</code>`).join('<br>')}</dd>` : ''}
<dt>Realtime</dt><dd>${b.realtime ? 'Published to the board (notify, then refetch)' : '<span class="none">not published</span>'}</dd>
</dl>${columnsTable(b)}`
    : `<p class="muted small">Specified in 02 §3; not built yet.${e.wps.length ? ` Planned in ${e.wps.join(', ')}.` : ''}</p>`;
  const status = b ? pill('done', 'Built') : pill('queued', 'Specified');
  return `<details class="row" id="t-${e.name}" data-item data-f-domain="${domainKey}" data-f-built="${b ? 'built' : 'specified'}">
<summary><span class="id">${esc(e.name)}</span><span class="what"><span class="title long">${mdInline(e.keyCols, ctx)}</span><span class="facts"><span>${e.reqs.length} requirements</span>${
    e.wps.length ? `<span>${tags(ctx, e.wps)}</span>` : ''
  }${b ? `<span>${b.columns.length} columns · ${b.policies.length} policies</span>` : ''}</span></span><span class="side">${status}${icon('chevron-down', 'i chev')}</span></summary>
<div class="row-body"><p>${mdInline(e.notes, ctx)}</p>${builtDetail}<dl class="kv"><dt>Requirements</dt><dd>${reqTrace}</dd></dl></div></details>`;
}

export function dataModel(m, ctx) {
  const D = m.src.data;
  const ents = [...m.entities.values()];
  const built = ents.filter((e) => e.built);
  const policies = built.reduce((s, e) => s + e.built.policies.length, 0);
  const definers = m.db.functions.filter((f) => f.definer);
  const pgtap = m.tests.filter((t) => t.kind === 'pgTAP').reduce((s, t) => s + t.count, 0);

  const erds = m.erds
    .map(
      (e) =>
        `<div class="sub" id="${e.anchor}"><h3>${esc(e.title.replace(/^[0-9.]+\s+/, ''))}</h3>${md(e.md, ctx)}</div>`,
    )
    .join('');

  const bar = filterBar({
    noun: 'tables',
    placeholder: 'Search tables, columns, notes, requirement IDs…',
    groups: [
      {
        facet: 'domain',
        label: 'Domain',
        options: m.catalog.map((c) => ({
          value: c.anchor,
          label: c.title,
          count: c.tables.length,
        })),
      },
      {
        facet: 'built',
        label: 'Build',
        options: [
          { value: 'built', label: 'Built', icon: 'check-circle', count: built.length },
          {
            value: 'specified',
            label: 'Specified',
            icon: 'hourglass',
            count: ents.length - built.length,
          },
        ],
      },
    ],
  });
  const catalog = m.catalog
    .map((c) => {
      const rows = c.tables
        .map((t) => tableRow(m, ctx, m.entities.get(t.name), c.anchor))
        .join('\n');
      return `<div class="sub" data-group id="${c.anchor}"><div class="group-h"><h3>${esc(c.title)}</h3><span class="muted small">${c.tables.length} tables · ${
        c.tables.filter((t) => m.entities.get(t.name).built).length
      } built</span></div>${c.intro ? `<div class="prose">${md(c.intro, ctx)}</div>` : ''}<div class="rows">${rows}</div>${c.extra ? `<div class="prose wide">${md(c.extra, ctx)}</div>` : ''}</div>`;
    })
    .join('\n');

  // Key DDL: prose visible, SQL folded so the page stays scannable.
  const ddl = md(fullMd(need(D, '4.')), ctx).replace(
    /<div class="code"><pre><code class="lang-sql">([\s\S]*?)<\/code><\/pre><\/div>/g,
    (x, code) => {
      const lines = code.split('\n').length;
      return `<details class="more"><summary>Show SQL (${lines} lines)</summary>${x}</details>`;
    },
  );

  // Catalog health ---------------------------------------------------------------------
  const pub = [...m.db.tables.values()].filter((t) => t.schema === 'public');
  const noTenant = pub.filter(
    (t) => t.name !== 'household' && !t.columns.some((c) => c.name === 'household_id'),
  );
  const unmapped = ents.filter((e) => !e.reqs.length && !e.name.includes('.'));
  const notInCatalog = [...m.db.tables.values()].filter(
    (t) => !m.entities.has(t.schema === 'public' ? t.name : `${t.schema}.${t.name}`),
  );
  const check = (ok, text, extra = '') =>
    `<li class="${ok ? 'ok' : 'warn'}">${icon(ok ? 'check-circle' : 'warning')} ${text}${extra}</li>`;
  const health = `<ul class="checks">
${check(!notInCatalog.length, 'Every table the migrations create is in the catalog.', notInCatalog.length ? ` Missing: ${notInCatalog.map((t) => `<code>${esc(t.name)}</code>`).join(', ')}` : '')}
${check(
  pub.every((t) => t.rls),
  `Every built public table has row level security (${pub.length} of ${pub.length}).`,
)}
${check(!noTenant.length, 'Every built public table except <code>household</code> carries <code>household_id</code>.', noTenant.length ? ` Missing: ${noTenant.map((t) => t.name).join(', ')}` : '')}
${check(
  definers.every((f) => f.name.startsWith('private.')),
  `Security-definer functions live in the <code>private</code> schema (${definers.map((f) => `<code>${esc(f.name)}</code>`).join(', ')}).`,
)}
${check(!unmapped.length, 'Every catalog table traces to at least one requirement.', unmapped.length ? ` Not yet: ${unmapped.map((e) => tag(ctx, e.name)).join(' ')}` : '')}
<li class="muted">${icon('info')} The same rules run in CI as pgTAP: <code>supabase/tests/001_schema_lint.test.sql</code> fails the build if a public table lacks RLS or <code>household_id</code>.</li>
</ul>`;

  const body = [
    section('s-1', 'Conventions', `<div class="prose">${md(need(D, '1.').md, ctx)}</div>`),
    section('s-2', 'Entity-relationship diagrams', erds),
    section(
      's-3',
      'Table catalog',
      `${bar}<p class="empty" data-empty hidden>No tables match. Clear the filters to see all ${ents.length}.</p>${catalog}`,
      {
        note: 'Every table in 02 §3. Built tables show what the migrations actually create: columns, row level security, policies, triggers and realtime.',
        tools:
          '<span class="tools"><button type="button" class="btn" data-expand="s-3" aria-pressed="false">Expand all</button></span>',
      },
    ),
    section('s-4', 'Key DDL', `<div class="prose wide">${ddl}</div>`),
    section(
      's-5',
      'Rules-engine contract',
      `<div class="prose wide">${md(fullMd(need(D, '5.')), ctx)}</div>`,
    ),
    section(
      's-6',
      'Indexing, retention, lifecycle',
      `<div class="prose wide">${md(need(D, '6.').md, ctx)}</div>`,
    ),
    section(
      's-7',
      'Entity → requirement map',
      `<div class="prose wide">${md(need(D, '7.').md, ctx)}</div>`,
    ),
    section('health', 'Catalog health', health),
  ].join('\n');

  return shell({
    m,
    ctx,
    page: 'data-model',
    h1: 'Data model',
    lede: mdInline(
      'Postgres on Supabase with `household_id` and row level security on every table. Completion events and the points ledger are append-only truth; occurrence status, progress and history are persisted projections that can be rebuilt from them.',
      ctx,
    ),
    stats: [
      { label: 'tables specified', value: ents.length },
      { label: 'domains', value: m.catalog.length },
      { label: 'built in migrations', value: built.length },
      { label: 'RLS policies', value: policies },
      { label: 'security-definer functions', value: definers.length },
      { label: 'pgTAP assertions', value: pgtap },
    ],
    latest: latestNote(ctx.docNode),
    toc: [
      { id: 's-1', label: 'Conventions' },
      {
        id: 's-2',
        label: 'ERDs',
        sub: m.erds.map((e) => ({ id: e.anchor, label: e.title.replace(/^[0-9.]+\s+/, '') })),
      },
      {
        id: 's-3',
        label: 'Table catalog',
        sub: m.catalog.map((c) => ({ id: c.anchor, label: c.title })),
      },
      { id: 's-4', label: 'Key DDL' },
      { id: 's-5', label: 'Rules-engine contract' },
      { id: 's-6', label: 'Indexing and lifecycle' },
      { id: 's-7', label: 'Entity → requirement map' },
      { id: 'health', label: 'Catalog health' },
    ],
    body,
  });
}
