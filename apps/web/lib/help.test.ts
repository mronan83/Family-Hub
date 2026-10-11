import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchor, guidePath, loadHelp, renderHelp } from './help';

// [D-72] Help is the user guide (docs/07) made into a page at build time.
const page = loadHelp();
const root = dirname(dirname(guidePath()));

describe('Help', () => {
  it('[D-72] says which version of the guide it is', () => {
    expect(page.version).toMatch(/^\d+\.\d+$/);
  });

  it("[D-72] every link inside the guide lands on one of the page's headings", () => {
    const ids = new Set([...page.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const links = [...page.html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(20);
    expect(links.filter((l) => !ids.has(l))).toEqual([]);
  });

  it('[D-72] keeps out what is only for the people building FamilyWise', () => {
    expect(page.html).not.toContain('How this guide is kept current');
    expect(page.html).not.toContain('Stories this guide covers');
    expect(page.html).not.toContain('covers:');
    expect(page.html).not.toContain('guide-exclusions');
    expect(page.html).toContain('id="a1-getting-started"');
    expect(page.html).toContain('id="b7-coming-soon"');
  });

  it('[D-72] shows every picture from the guide, each one there to show', () => {
    const shots = [...page.html.matchAll(/<img src="\/guide\/img\/([^"]+)" alt="([^"]*)"/g)];
    expect(shots.length).toBeGreaterThan(20);
    for (const [, file, alt] of shots) {
      expect(existsSync(join(root, 'docs/guide/img', file!)), file).toBe(true);
      expect(alt!.length, file).toBeGreaterThan(20);
    }
  });

  it('[D-72] keeps diagrams as source for the browser to draw, and wraps tables to scroll', () => {
    const md = readFileSync(guidePath(), 'utf8');
    const diagrams = (md.match(/^```mermaid/gm) ?? []).length;
    expect(page.html.match(/<pre class="mermaid">/g)).toHaveLength(diagrams);
    expect(page.html).toContain('<div class="fw-help__table"><table>');
  });

  it("uses GitHub's heading anchors", () => {
    expect(anchor("A2 A parent's day")).toBe('a2-a-parents-day');
    expect(anchor('Part A — User Guide')).toBe('part-a--user-guide');
    expect(anchor('"Not actually done"')).toBe('not-actually-done');
  });

  it('marks tips and notes, and escapes code', () => {
    const { html } = renderHelp(
      '# T\n\n> Version 9.9\n\n## How this guide is kept current\n\nx\n\n## B8 Stories this guide covers\n\ny\n\n## Part\n\n> **Tip:** do it.\n\n```\n<b>\n```\n',
    );
    expect(html).toContain('fw-help__callout--tip');
    expect(html).toContain('&lt;b&gt;');
  });
});
