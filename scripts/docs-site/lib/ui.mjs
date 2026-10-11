// Shared building blocks for the six pages: the shell (masthead, hero, contents, footer), status pills,
// ID tags, meters, filter bar, and the hover index. Every color comes from tokens in site.css.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, mdInline } from './md.mjs';
import { REPO_URL, STATUS, STATUS_ORDER } from './model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(here, 'site.css'), 'utf8');
const JS = readFileSync(join(here, 'site.js'), 'utf8');

export const PAGES = [
  {
    key: 'architecture',
    label: 'Architecture',
    title: 'FamilyWise Technical Architecture',
    file: 'docs/01-technical-architecture.md',
  },
  {
    key: 'data-model',
    label: 'Data model',
    title: 'FamilyWise Data Model',
    file: 'docs/02-data-model.md',
  },
  {
    key: 'requirements',
    label: 'Requirements',
    title: 'FamilyWise Requirements & Traceability',
    file: 'docs/04-requirements-traceability.md',
  },
  {
    key: 'stories',
    label: 'User stories',
    title: 'FamilyWise User Stories',
    file: 'docs/03-user-stories.md',
  },
  { key: 'backlog', label: 'Backlog', title: 'FamilyWise Backlog', file: 'docs/05-backlog.md' },
  {
    key: 'user-guide',
    label: 'User guide',
    title: 'FamilyWise User Guide and Manual',
    file: 'docs/07-user-guide.md',
  },
];

export const icon = (name, cls = 'i') =>
  `<svg class="${cls}" aria-hidden="true"><use href="#fw-${name}"></use></svg>`;

export const pill = (status, label) =>
  `<span class="pill st-${status}">${icon(STATUS[status].icon)}${esc(label || STATUS[status].label)}</span>`;

export const youPill = (label = 'Waiting on you') =>
  `<span class="pill st-you">${icon('person')}${esc(label)}</span>`;

// An ID as a small status-tinted tag that links to its home page.
export function tag(ctx, id, label) {
  const hit = ctx.index.get(id);
  if (!hit) {
    ctx.unknown.add(id);
    return `<span class="tag">${esc(label || id)}</span>`;
  }
  const st = hit.status;
  const you = hit.kind === 'Waiting on you';
  const cls = st ? ` st-${st}` : you ? ' st-you' : '';
  const ic = st ? icon(STATUS[st].icon) : you ? icon('person') : '';
  return `<a class="tag${cls}" data-id="${esc(id)}" href="xref:${hit.page}#${hit.anchor}">${ic}<span>${esc(label || id)}</span></a>`;
}

export const tags = (ctx, ids) =>
  ids.length
    ? `<span class="tags">${ids.map((i) => tag(ctx, i)).join('')}</span>`
    : '<span class="none">none</span>';

export const ghUrl = (m, path, line) =>
  `${REPO_URL}/blob/${m.git.sha}/${path}${line ? `#L${line}` : ''}`;
export const ghLink = (m, path, label = path, line) =>
  `<a class="file" href="${ghUrl(m, path, line)}" target="_blank" rel="noopener">${esc(label)}</a>`;

export function meter(done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<span class="meter" role="img" aria-label="${esc(label || `${done} of ${total} done`)}"><span style="width:${pct}%"></span></span>`;
}

// A stacked bar of statuses with a text legend (never color alone).
export function stack(counts, opts = {}) {
  const total = STATUS_ORDER.reduce((s, k) => s + (counts[k] || 0), 0);
  const parts = STATUS_ORDER.filter((k) => counts[k]);
  const words = parts.map((k) => `${counts[k]} ${STATUS[k].label.toLowerCase()}`).join(', ');
  const bar = parts
    .map(
      (k) =>
        `<span class="seg st-${k}" style="flex-grow:${counts[k]}" title="${counts[k]} ${STATUS[k].label}"></span>`,
    )
    .join('');
  return `<span class="stack${opts.small ? ' small' : ''}" role="img" aria-label="${esc(words)}">${bar}</span>${
    opts.legend === false
      ? ''
      : `<span class="stack-l">${esc(words || 'none')}${total ? '' : ''}</span>`
  }`;
}

// The newest "vX.Y: ..." line of a doc's header.
export function latestNote(doc) {
  const line = doc.meta.find((l) => /^v[0-9.]+:/.test(l));
  if (!line) return null;
  const [version, ...rest] = line.split(':');
  return { version, text: rest.join(':').trim() };
}

// Gives each body cell of plain <table> markup its column name, so the table can restack into
// labeled cards on phones (table.md rules in site.css). Cells that set their own label keep it.
export function labelled(html) {
  return html.replace(/<table>([\s\S]*?)<\/table>/g, (whole, inner) => {
    const head = inner.match(/<thead>([\s\S]*?)<\/thead>/);
    const labels = head
      ? [...head[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((x) =>
          x[1].replace(/<[^>]+>/g, '').trim(),
        )
      : [];
    const body = inner.replace(/<tr>([\s\S]*?)<\/tr>/g, (row, cells) => {
      let col = 0;
      return `<tr>${cells.replace(/<(th scope="row"|td)([^>]*)>/g, (m, tag, attrs) => {
        const label = labels[col] || '';
        col += Number((attrs.match(/colspan="(\d+)"/) || [])[1] || 1);
        return tag === 'td' && !attrs.includes('data-label')
          ? `<td data-label="${esc(label)}"${attrs}>`
          : m;
      })}</tr>`;
    });
    return `<table class="md">${body}</table>`;
  });
}

export const countBy = (arr, f) => arr.reduce((o, x) => ((o[f(x)] = (o[f(x)] || 0) + 1), o), {});

export function section(id, title, body, opts = {}) {
  const note = opts.note ? `<p class="sec-note">${opts.note}</p>` : '';
  const extra = opts.anchors
    ? opts.anchors.map((a) => `<span id="${a}" class="anchor"></span>`).join('')
    : '';
  return `<section class="sec${opts.cls ? ' ' + opts.cls : ''}" id="${id}">${extra}<div class="sec-head"><h2>${esc(
    title,
  )}</h2>${opts.tools || ''}</div>${note}${body}</section>`;
}

export function filterBar({ groups, placeholder, noun }) {
  const facet = (g) =>
    `<div class="facet" role="group" aria-label="${esc(g.label)}"><span class="facet-l">${esc(g.label)}</span>${g.options
      .map(
        (o) =>
          `<button type="button" class="chip${o.cls ? ' ' + o.cls : ''}" data-facet="${g.facet}" data-value="${esc(
            o.value,
          )}" aria-pressed="false">${o.icon ? icon(o.icon) : ''}${esc(o.label)}${
            o.count != null ? `<span class="n">${o.count}</span>` : ''
          }</button>`,
      )
      .join('')}</div>`;
  const toggle = groups.length
    ? `<button type="button" class="btn facet-toggle" aria-expanded="false" aria-controls="facets">${icon('list-check')}Filters<span class="n" hidden></span></button>`
    : '';
  return `<div class="filters" data-noun="${esc(noun)}">
  <div class="filter-top"><div class="search">${icon('search')}<label class="sr" for="q">Search ${esc(noun)}</label><input id="q" type="search" placeholder="${esc(
    placeholder,
  )}" autocomplete="off" spellcheck="false" enterkeyhint="search"><kbd aria-hidden="true">/</kbd></div>${toggle}</div>
  ${groups.length ? `<div class="facets" id="facets">${groups.map(facet).join('')}</div>` : ''}
  <p class="count"><span id="count" aria-live="polite"></span><span class="temp-filter" hidden></span><button type="button" class="reset" hidden>Clear filters</button></p>
</div>`;
}

const SPRITE = readFileSync(join(here, '../../../brand/icons/sprite.svg'), 'utf8').replace(
  'style="display:none"',
  'width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"',
);

const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M14 31 L32 16 L50 31" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M23 40 L30 47 L42 34" fill="none" stroke="var(--sun)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Detroit',
  });

export function shell({
  m,
  ctx,
  page,
  h1,
  lede,
  stats = [],
  latest,
  toc = [],
  body,
  legend = true,
}) {
  const p = PAGES.find((x) => x.key === page);
  const doc = ctx.docNode;
  const nav = PAGES.map(
    (x) =>
      `<li><a href="xref:${x.key}#top"${x.key === page ? ' aria-current="page"' : ''}>${esc(x.label)}</a></li>`,
  ).join('');
  const tocList = `<ol>${toc
    .map(
      (t) =>
        `<li><a href="#${t.id}">${esc(t.label)}</a>${
          t.sub
            ? `<ol>${t.sub.map((s) => `<li><a href="#${s.id}">${esc(s.label)}</a></li>`).join('')}</ol>`
            : ''
        }</li>`,
    )
    .join('')}</ol>`;
  const statHtml = stats.length
    ? `<dl class="stats">${stats
        .map(
          (s) =>
            `<div class="stat${s.cls ? ' ' + s.cls : ''}"><dt>${esc(s.label)}</dt><dd>${s.value}</dd></div>`,
        )
        .join('')}</dl>`
    : '';
  const latestHtml = latest
    ? `<aside class="latest" aria-label="Latest change"><p class="eyebrow">Latest change · ${esc(latest.version)}</p><p>${mdInline(
        latest.text,
        ctx,
      )}</p></aside>`
    : '';
  const branch = m.git.branch
    ? ` on <a href="${REPO_URL}/tree/${esc(m.git.branch)}" target="_blank" rel="noopener"><code>${esc(m.git.branch)}</code></a>`
    : '';
  const legendHtml = legend
    ? `<div class="legend"><p class="eyebrow">Status key</p><p>${STATUS_ORDER.map((k) => pill(k)).join(' ')} ${youPill()}</p><p>Statuses come from the backlog status board (<a class="ref secref" href="xref:backlog#s-1">05 §1</a>). A requirement or story takes the combined status of its work packages: done when all are done, in progress once any has started, blocked when everything left is blocked.</p></div>`
    : '';
  const index = JSON.stringify(
    Object.fromEntries([...ctx.index].map(([id, v]) => [id, [v.title, v.status || '', v.kind]])),
  ).replace(/</g, '\\u003c');
  return `<title>${esc(p.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Nunito:wght@700;800&display=swap">
<style>
${CSS}
</style>
${SPRITE}
<div class="page" id="top">
<header class="mast">
  <a class="brand" href="xref:architecture#top">${MARK}<span class="word">Family<b>Wise</b></span><span class="brand-sub">build docs</span></a>
  <nav aria-label="Build documents"><ul>${nav}</ul></nav>
</header>
<header class="hero">
  <p class="eyebrow">FamilyWise · ${esc(p.label)}</p>
  <h1>${esc(h1)}</h1>
  <p class="meta">Generated from ${ghLink(m, p.file, p.file.replace('docs/', ''))}${doc.version ? ` v${esc(doc.version)}` : ''} at <a href="${REPO_URL}/commit/${m.git.sha}" target="_blank" rel="noopener"><code>${m.git.short}</code></a>${branch} · ${fmtDate(
    m.git.date,
  )}</p>
  ${lede ? `<p class="lede">${lede}</p>` : ''}
  ${statHtml}
  ${latestHtml}
</header>
<details class="toc-m"><summary>Contents</summary><nav aria-label="Contents">${tocList}</nav></details>
<div class="layout">
  <aside class="toc"><nav aria-label="Contents"><p class="eyebrow">On this page</p>${tocList}</nav></aside>
  <main>
${body}
${legendHtml}
  </main>
</div>
<footer class="foot"><p>${MARK}FamilyWise build docs. Each page is generated from the markdown in <code>docs/</code> and the repository by <code>pnpm docs:build</code>; edit the markdown, not the page. Hover or focus any ID for its title and status; IDs link across the pages.</p></footer>
</div>
<script type="application/json" id="fw-index">${index}</script>
<script>
${JS}
</script>
`;
}
