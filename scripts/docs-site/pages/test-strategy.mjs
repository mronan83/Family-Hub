// Test strategy (docs/08, NFR-19): the strategy's sections as prose, and the Test catalogue (§9),
// which check_traceability.py generates from every test's name. Test names sit in code spans, so
// only the IDs the check has already validated become links.
import { esc, fullMd, md } from '../lib/md.mjs';
import { latestNote, section, shell } from '../lib/ui.mjs';

export function testStrategy(m, ctx) {
  const doc = ctx.docNode;
  const parts = doc.children;
  const intro = doc.md
    .split('\n')
    .filter((l) => !l.startsWith('>'))
    .join('\n');
  const all = fullMd(doc);
  const cat = doc.children.find((c) => c.title.startsWith('9.')) || { md: '' };
  const catMd = fullMd(cat);
  const total = (catMd.match(/^\*\*(\d+)\*\* tests:/m) || [])[1] || '0';
  const knownGaps = (catMd.match(/\*\*(\d+)\*\* known gaps:/) || [])[1] || '0';
  const cases = (catMd.match(/^\| Test cases \| (\d+)/m) || [])[1] || '0';
  const files = (catMd.match(/^#### `/gm) || []).length;
  const diagrams = (all.match(/^```mermaid/gm) || []).length;

  // §9.7 lists every test (thousands): on the page each file folds to one line, and each test is its
  // name alone (its IDs are in it), so the page stays small enough to republish. The markdown keeps
  // the full table with each test's IDs.
  const everyTest = (node) => {
    const files = [
      ...fullMd(node).matchAll(
        /^#### `([^`]+)`\n\n([^\n]+)\n\n\| Test \| Names \|\n\|---\|---\|\n((?:\|[^\n]*\n?)*)/gm,
      ),
    ];
    const intro = node.md;
    const list = files
      .map(([, file, meta, rows]) => {
        const names = rows
          .trim()
          .split('\n')
          .map((r) => (r.match(/^\| `(.*)` \|/) || [])[1])
          .filter(Boolean)
          .map((n) => `<li>${esc(n.replace(/\\\|/g, '|'))}</li>`)
          .join('\n');
        return `<details class="more"><summary><code>${esc(file)}</code> · ${esc(meta)}</summary><ol class="tests">${names}</ol></details>`;
      })
      .join('\n');
    return `${md(intro, ctx)}${list}`;
  };
  const catalogue = (p) =>
    md(p.md, ctx) +
    p.children
      .map((c) =>
        c.title.startsWith('9.7')
          ? `<h3 id="${c.anchor}">${esc(c.title)}</h3>${everyTest(c)}`
          : md(`### ${c.title}\n\n${fullMd(c)}`, ctx),
      )
      .join('\n');

  const sections = parts.map((p) => ({
    id: p.anchor,
    label: p.title.replace(/^\d+\.\s*/, ''),
    sub: p.title.startsWith('9.')
      ? p.children.map((c) => ({ id: c.anchor, label: c.title }))
      : undefined,
    html: section(
      p.anchor,
      p.title,
      `<div class="prose">${p.title.startsWith('9.') ? catalogue(p) : md(fullMd(p), ctx)}</div>`,
    ),
  }));

  return shell({
    m,
    ctx,
    page: 'test-strategy',
    h1: 'Test strategy',
    lede: 'How FamilyWise is tested: which tests run for which change, the rules for each, and the Test catalogue that traces every test to the requirements, stories and backlog items it proves.',
    stats: [
      { label: 'tests', value: total },
      { label: 'test files', value: files },
      { label: 'test cases', value: cases },
      { label: 'known gaps', value: knownGaps },
      { label: 'diagrams', value: diagrams },
    ],
    latest: latestNote(doc),
    toc: [
      { id: 'about', label: 'About this page' },
      ...sections.map(({ id, label, sub }) => ({ id, label, sub })),
    ],
    body: [
      section('about', 'About this page', `<div class="prose">${md(intro, ctx)}</div>`),
      ...sections.map((s) => s.html),
    ].join('\n'),
    legend: false,
  });
}
