// Test strategy (docs/08, NFR-18): the strategy's sections as prose, and the Test catalogue (§9),
// which check_traceability.py generates from every test's name. Test names sit in code spans, so
// only the IDs the check has already validated become links.
import { fullMd, md } from '../lib/md.mjs';
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

  const sections = parts.map((p) => ({
    id: p.anchor,
    label: p.title.replace(/^\d+\.\s*/, ''),
    sub: p.title.startsWith('9.')
      ? p.children.map((c) => ({ id: c.anchor, label: c.title }))
      : undefined,
    html: section(p.anchor, p.title, `<div class="prose">${md(fullMd(p), ctx)}</div>`),
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
