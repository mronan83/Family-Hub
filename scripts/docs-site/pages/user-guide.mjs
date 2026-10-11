// User guide and manual (docs/07, D-68): Part A by task, Part B for reference. Headings keep GitHub's
// anchors, so the guide's own links work in the markdown and here alike. Each section's hidden
// `<!-- covers: ... -->` line shows as a small Covers line with the stories it covers, "Tip" and
// "Note" quotes become callouts, and the screenshots are embedded so the page stands on its own.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { esc, fullMd, linkify, RENDERER } from '../lib/md.mjs';
import { latestNote, section, shell, tag } from '../lib/ui.mjs';

const docs = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs');

/** A heading's anchor as GitHub makes it: "A2 A parent's day" → "a2-a-parents-day". */
export const ghSlug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[*`]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

const marked = new Marked({
  gfm: true,
  renderer: {
    ...RENDERER,
    heading({ tokens, depth, text }) {
      const level = Math.min(6, Math.max(3, depth));
      return `<h${level} id="${ghSlug(text)}">${this.parser.parseInline(tokens)}</h${level}>\n`;
    },
  },
});

const COVERS = /^<!--\s*covers:(.*?)-->\s*$/gm;
const IMG = /<p><img src="([^"]+)" alt="([^"]*)"(?: title="([^"]*)")?\s*\/?>\s*<\/p>/g;

// How wide a picture shows: phones at a phone's width, the tall tile list narrower still.
const shotKind = (src) =>
  /-phone\.\w+$/.test(src) ? 'phone' : /tile-states/.test(src) ? 'tall' : 'wide';

function picture(src, alt, title) {
  const file = join(docs, src);
  if (!/^guide\/img\/[\w.-]+\.(jpg|png|webp)$/.test(src) || !existsSync(file)) {
    throw new Error(`docs-site: 07 shows a picture that isn't in docs/guide/img: ${src}`);
  }
  const type = src.endsWith('.png') ? 'png' : src.endsWith('.webp') ? 'webp' : 'jpeg';
  const data = readFileSync(file).toString('base64');
  return `<figure class="shot shot--${shotKind(src)}"><img src="data:image/${type};base64,${data}" alt="${alt}" loading="lazy" decoding="async">${
    title ? `<figcaption>${title}</figcaption>` : ''
  }</figure>`;
}

/** One part of the guide, from markdown to the page's HTML. */
function render(source, ctx) {
  const withCovers = source.replace(COVERS, (_, ids) => `\n@@covers ${ids.trim()}@@\n`);
  const html = marked
    .parse(withCovers)
    .replace(/<p>@@covers ([^@]*)@@<\/p>/g, (_, ids) => {
      const list = ids.split(/\s+/).filter(Boolean);
      return `<p class="covers"><span class="covers-l">Covers</span><span class="tags">${list
        .map((id) => tag(ctx, id))
        .join('')}</span></p>`;
    })
    .replace(/<blockquote>\s*<p><strong>(Tip|Note):<\/strong>/g, (_, kind) => {
      return `<blockquote class="callout callout--${kind.toLowerCase()}"><p><strong>${kind}:</strong>`;
    })
    .replace(IMG, (_, src, alt, title) => picture(src, alt, title));
  return linkify(html, ctx);
}

export function userGuide(m, ctx) {
  const doc = ctx.docNode;
  const parts = doc.children.filter((c) => c.title !== 'Contents');
  const intro = doc.md
    .split('\n')
    .filter((l) => !l.startsWith('>'))
    .join('\n');

  const sections = parts.map((p) => {
    const id = ghSlug(p.title);
    return {
      id,
      label: p.title,
      sub: p.children.map((c) => ({ id: ghSlug(c.title), label: c.title })),
      html: section(id, p.title, `<div class="prose guide">${render(fullMd(p), ctx)}</div>`),
    };
  });

  const all = fullMd(doc);
  const shots = (all.match(/!\[[^\]]*\]\(guide\/img\//g) || []).length;
  const diagrams = (all.match(/^```mermaid/gm) || []).length;
  const covered = new Set(
    [...all.matchAll(COVERS)].flatMap((x) => x[1].match(/US-\d{3,4}/g) || []),
  );
  const count = (prefix) =>
    parts.filter((p) => p.title.startsWith(prefix)).flatMap((p) => p.children).length;

  const body = [
    section('about', 'About this guide', `<div class="prose guide">${render(intro, ctx)}</div>`),
    ...sections.map((s) => s.html),
  ].join('\n');

  return shell({
    m,
    ctx,
    page: 'user-guide',
    h1: 'User guide and manual',
    lede: esc(
      'How to use FamilyWise: for parents in the admin app, and for everyone at the board. Part A walks through each task step by step; Part B is the reference for every page, screen, rule and limit.',
    ),
    stats: [
      { label: 'guide sections', value: count('Part A') },
      { label: 'manual sections', value: count('Part B') },
      { label: 'screenshots', value: shots },
      { label: 'diagrams', value: diagrams },
      { label: 'stories covered', value: covered.size },
    ],
    latest: latestNote(doc),
    toc: [
      { id: 'about', label: 'About this guide' },
      ...sections.map(({ id, label, sub }) => ({
        id,
        label: label.replace(/^How this guide is kept current$/, 'Keeping it current'),
        sub: sub.length ? sub : undefined,
      })),
    ],
    body,
    legend: false,
  });
}
