// The user guide in the app (D-72): docs/07-user-guide.md made into one page at build time, so Help
// can never drift from the guide. Headings keep GitHub's anchors, so the guide's own links work
// here as they do on GitHub and the published page. What is only for the people building
// FamilyWise stays out: how the guide is kept current, and which stories it covers.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Marked, type Tokens } from 'marked';

/** Sections left out of the app, by heading. */
const LEFT_OUT = ['How this guide is kept current', 'B8 Stories this guide covers'];

export interface HelpPage {
  version: string;
  html: string;
}

/** docs/07-user-guide.md, found from the app's folder (where next build runs) or the repo root. */
export function guidePath(from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    const file = join(dir, 'docs/07-user-guide.md');
    if (existsSync(file)) return file;
    const up = dirname(dir);
    if (up === dir) throw new Error('docs/07-user-guide.md not found');
    dir = up;
  }
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GitHub's heading anchor: lowercase, punctuation dropped, each space a hyphen. */
export function anchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/ /g, '-');
}

/** Drops a section (its heading and everything up to the next heading of its level or higher). */
function dropSection(md: string, title: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && l.replace(/^#+ /, '') === title);
  if (start < 0) throw new Error(`the guide has no section "${title}"`);
  const level = lines[start]!.match(/^#+/)![0].length;
  let end = start + 1;
  let fence = false;
  for (; end < lines.length; end++) {
    if (lines[end]!.startsWith('```')) fence = !fence;
    const m = !fence && lines[end]!.match(/^(#+) /);
    if (m && m[1]!.length <= level) break;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

/** [D-72] The guide as Help shows it. */
export function renderHelp(md: string): HelpPage {
  const version = md.match(/^> Version ([0-9.]+)/m)?.[1] ?? '';
  let body = md
    // The title, then the version lines: the page has its own heading and says the version once.
    .replace(/^# .*\n/, '')
    .replace(/^(>.*\n)+/m, '')
    // Hidden notes for the coverage check.
    .replace(/<!--[\s\S]*?-->\n?/g, '');
  for (const title of LEFT_OUT) {
    body = dropSection(body, title);
    // …and its line in the contents.
    body = body.replace(
      new RegExp(
        `^\\s*- \\[${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\(#[^)]*\\)\\n`,
        'm',
      ),
      '',
    );
  }

  const used = new Map<string, number>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth, text: raw }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens);
        // From the heading's own words, as GitHub does, not the HTML (where ' is &#39;).
        const base = anchor(raw);
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        // The guide's ## (Part A, Part B) sits under the page's own <h1>.
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        if (lang === 'mermaid') {
          return `<figure class="fw-help__diagram"><pre class="mermaid">${escape(text)}</pre></figure>\n`;
        }
        return `<pre><code>${escape(text)}</code></pre>\n`;
      },
      image({ href, title, text }: Tokens.Image) {
        const src = href.replace(/^guide\/img\//, '/guide/img/');
        const phone = /-phone\.jpg$/.test(src) ? ' fw-help__shot--phone' : '';
        const caption = title ? `<figcaption>${escape(title)}</figcaption>` : '';
        return `<figure class="fw-help__shot${phone}"><img src="${escape(src)}" alt="${escape(text)}" loading="lazy" decoding="async">${caption}</figure>`;
      },
      table(token: Tokens.Table) {
        const cell = (c: Tokens.TableCell) => this.parser.parseInline(c.tokens);
        const head = token.header.map((c) => `<th scope="col">${cell(c)}</th>`).join('');
        const rows = token.rows
          .map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`)
          .join('\n');
        return `<div class="fw-help__table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
      blockquote({ tokens }: Tokens.Blockquote) {
        const inner = this.parser.parse(tokens);
        const kind = /^<p><strong>Tip:<\/strong>/.test(inner)
          ? 'tip'
          : /^<p><strong>Note:<\/strong>/.test(inner)
            ? 'note'
            : 'quote';
        return `<aside class="fw-help__callout fw-help__callout--${kind}">${inner}</aside>\n`;
      },
    },
  });
  // A picture alone in a paragraph is a figure, not inside a <p>.
  const html = (marked.parse(body, { async: false }) as string).replace(
    /<p>(<figure class="fw-help__shot[^"]*">[\s\S]*?<\/figure>)<\/p>/g,
    '$1',
  );
  return { version, html };
}

/** Reads and renders the guide; called while the page is built. */
export function loadHelp(): HelpPage {
  return renderHelp(readFileSync(guidePath(), 'utf8'));
}
