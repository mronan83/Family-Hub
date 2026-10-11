// Markdown helpers for the docs site: split a doc into a heading tree, read its tables, and render
// fragments to HTML with requirement, story, work package and section references turned into links.
import { Marked } from 'marked';

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// "9.8 Secrets" -> s-9-8 · "A. Requirements register" -> s-a · "3.3b Points" -> s-3-3b
export function sectionAnchor(title) {
  const m = title.match(/^([0-9]+(?:\.[0-9]+)*[a-z]?|[A-I])\.?\s/);
  return m ? 's-' + m[1].toLowerCase().replace(/\./g, '-') : slug(title);
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export function parseDoc(text) {
  const root = { level: 0, title: '', lines: [], children: [] };
  const stack = [root];
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const node = { level: m[1].length, title: m[2].trim(), lines: [], children: [] };
      while (stack.at(-1).level >= node.level) stack.pop();
      stack.at(-1).children.push(node);
      stack.push(node);
    } else {
      stack.at(-1).lines.push(line);
    }
  }
  const finish = (n) => {
    n.md = n.lines.join('\n').trim();
    n.anchor = n.level ? sectionAnchor(n.title) : '';
    n.children.forEach(finish);
  };
  finish(root);
  const doc = root.children[0];
  doc.meta = doc.lines.filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, ''));
  doc.version = (doc.meta[0]?.match(/Version\s+([0-9.]+)/) || [])[1] || '';
  return doc;
}

export function find(node, prefix) {
  for (const c of node.children) {
    if (c.title.startsWith(prefix)) return c;
    const hit = find(c, prefix);
    if (hit) return hit;
  }
  return null;
}

export function need(node, prefix) {
  const hit = find(node, prefix);
  if (!hit) throw new Error(`docs-site: section "${prefix}" not found under "${node.title}"`);
  return hit;
}

// The section's own body plus its subsections, as markdown.
export function fullMd(node, shift = 0) {
  const out = [node.md];
  for (const c of node.children) {
    out.push(`${'#'.repeat(Math.min(6, c.level + shift))} ${c.title}`, fullMd(c, shift));
  }
  return out.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function splitRow(line) {
  const cells = [];
  let cur = '';
  let tick = false;
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      tick = !tick;
      cur += ch;
    } else if (ch === '|' && !tick) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function tables(md) {
  const out = [];
  let block = [];
  const flush = () => {
    if (block.length >= 2 && /^[\s|:-]+$/.test(block[1]) && block[1].includes('---')) {
      const header = splitRow(block[0]);
      const rows = block.slice(2).map(splitRow);
      out.push({ header, rows });
    }
    block = [];
  };
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    if (!fence && line.trim().startsWith('|')) block.push(line);
    else flush();
  }
  flush();
  return out;
}

export const table = (md, i = 0) => {
  const t = tables(md)[i];
  if (!t) throw new Error('docs-site: expected a table');
  return t;
};

// Rows as objects keyed by lower-cased header text.
export const records = (t) =>
  t.rows.map((r) => Object.fromEntries(t.header.map((h, i) => [slug(h) || `c${i}`, r[i] ?? ''])));

export const stripMd = (s) =>
  String(s ?? '')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .trim();

export const bullets = (md) =>
  md
    .split('\n')
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, ''));

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const REQ = 'ACC|DEV|CHR|RWD|CAL|SCH|MEAL|MENU|BRD|PTS|NFR';
const ID_RX = new RegExp(
  `\\b(${REQ})-(\\d{2})((?:\\/\\d{2})+|\\.\\.\\d{2})?|\\b(US-\\d{3,4}|WP-\\d{2}|SPIKE-\\d{2}|OQ-\\d{2}b?|[DRAL]-\\d{2}|Y-\\d)\\b`,
  'g',
);
const SEC_RX = /(\b0[0-6] )?§\s?([0-9]+(?:\.[0-9]+)*[a-z]?|[A-I](?![a-z]))/g;
const DOC_PAGE = {
  '00': ['architecture', 'decisions'],
  '01': ['architecture'],
  '02': ['data-model'],
  '03': ['stories'],
  '04': ['requirements'],
  '05': ['backlog'],
  '07': ['user-guide'],
};

export function refLink(ctx, id, label = id) {
  const hit = ctx.index.get(id);
  if (!hit) {
    ctx.unknown?.add(id);
    return esc(label);
  }
  return `<a class="ref" data-id="${esc(id)}" href="xref:${hit.page}#${hit.anchor}">${esc(label)}</a>`;
}

function linkIds(text, ctx) {
  return text.replace(ID_RX, (m, dom, num, tail, other) => {
    if (other) return refLink(ctx, other);
    let out = refLink(ctx, `${dom}-${num}`);
    if (tail) {
      out += tail.replace(/\d{2}/g, (n) => refLink(ctx, `${dom}-${n}`, n));
    }
    return out;
  });
}

function linkSections(text, ctx, docHint) {
  let lastDoc = docHint || ctx.doc;
  let first = true;
  return text.replace(SEC_RX, (m, plain, sec, offset) => {
    let doc = lastDoc;
    if (plain) doc = plain.trim();
    else if (first && offset <= 1 && docHint) doc = docHint;
    first = false;
    lastDoc = doc;
    const target = DOC_PAGE[doc];
    if (!target) return m;
    const anchor =
      target[1] && doc === '00' ? target[1] : 's-' + sec.toLowerCase().replace(/\./g, '-');
    const label = plain ? m.slice(plain.length) : m;
    return `${plain || ''}<a class="ref secref" href="xref:${target[0]}#${anchor}">${label}</a>`;
  });
}

function linkCode(text, ctx) {
  if (ctx.tables?.has(text)) {
    return `<a class="ref code" data-id="${esc(text)}" href="xref:data-model#t-${text}">${text}</a>`;
  }
  if (ctx.components?.has(text)) {
    return `<a class="ref code" data-id="${text}" href="xref:architecture#comp-${text.toLowerCase()}">${text}</a>`;
  }
  return text;
}

// Turns IDs in text nodes, table names and component IDs in code spans, and § references into links.
export function linkify(html, ctx) {
  const parts = html.split(/(<[^>]+>)/);
  let inA = 0;
  let inPre = 0;
  let inCode = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('<')) {
      const t = p.match(/^<(\/?)([a-zA-Z0-9]+)/);
      if (t) {
        const d = t[1] ? -1 : 1;
        const name = t[2].toLowerCase();
        if (name === 'a') inA += d;
        else if (name === 'pre') inPre += d;
        else if (name === 'code') inCode += d;
      }
      continue;
    }
    if (!p || inA || inPre) continue;
    if (inCode) {
      parts[i] = linkCode(p, ctx);
      continue;
    }
    // "`01` §9.8": the code span two parts back names the doc the section belongs to.
    const code =
      parts[i - 1] === '</code>' ? (parts[i - 2] || '').match(/^(0[0-6])(?:-[a-z-]+\.md)?$/) : null;
    const hint = code ? code[1] : null;
    parts[i] = linkSections(linkIds(p, ctx), ctx, hint);
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// The renderer every page shares; the user guide swaps in its own headings (pages/user-guide.mjs).
export const RENDERER = {
  code({ text, lang }) {
    if (lang === 'mermaid') {
      return `<figure class="diagram"><pre class="mermaid">${esc(text)}</pre></figure>\n`;
    }
    const cls = lang ? ` class="lang-${esc(lang)}"` : '';
    return `<div class="code"><pre><code${cls}>${esc(text)}</code></pre></div>\n`;
  },
  heading({ tokens, depth, text }) {
    const level = Math.min(6, Math.max(3, depth));
    return `<h${level} id="${sectionAnchor(text)}">${this.parser.parseInline(tokens)}</h${level}>\n`;
  },
  table(token) {
    const labels = token.header.map((c) => esc(c.text.replace(/[`*]/g, '')));
    const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('');
    const body = token.rows
      .map(
        (row) =>
          '<tr>' +
          row
            .map(
              (c, i) => `<td data-label="${labels[i]}">${this.parser.parseInline(c.tokens)}</td>`,
            )
            .join('') +
          '</tr>',
      )
      .join('\n');
    return `<div class="table-wrap"><table class="md"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
  },
};

const marked = new Marked({ gfm: true, renderer: RENDERER });

export const md = (src, ctx) => linkify(marked.parse(src || ''), ctx);
export const mdInline = (src, ctx) => linkify(marked.parseInline(src || ''), ctx);
