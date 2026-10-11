#!/usr/bin/env node
// Copies the Lucide icons listed in brand/icons/lucide.json into the brand kit (WP-46, D-70):
// each as brand/icons/lucide/<name>.svg in the kit's own one-line form, and each into
// brand/icons/index.json with its picker group and search words (ours first, then Lucide's tags).
// An entry may name the Lucide file under "from" when we give the icon a name of our own.
// The icons come from the lucide-static devDependency, which must be the version the list names.
//
//   pnpm --filter @familywise/ui brand:lucide        rewrite brand/icons/lucide/ and index.json
//   pnpm --filter @familywise/ui brand:lucide --check fail if either is out of date
//
// Then run node packages/ui/scripts/brand.mjs to regenerate the app's icon module.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const brand = join(root, 'brand');
const outDir = join(brand, 'icons/lucide');
const check = process.argv.includes('--check');

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('lucide-static/package.json'));
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const tags = JSON.parse(readFileSync(join(pkgDir, 'tags.json'), 'utf8'));
const list = JSON.parse(readFileSync(join(brand, 'icons/lucide.json'), 'utf8'));
const groups = JSON.parse(readFileSync(join(brand, 'icons/groups.json'), 'utf8')).groups;

if (pkg.version !== list.version) {
  throw new Error(
    `lucide-static is ${pkg.version} but brand/icons/lucide.json names ${list.version}`,
  );
}

const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ELEMENT = /<(path|circle|rect|ellipse|line|polyline|polygon)\b([^>]*?)\/?>/g;
const ATTR = /([a-z][a-z0-9-]*)="([^"]*)"/g;

/** The drawing elements of a Lucide SVG, one after another, with nothing else kept. */
function body(name) {
  const svg = readFileSync(join(pkgDir, 'icons', `${name}.svg`), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const elements = [...inner.matchAll(ELEMENT)].map(([, tag, attrs]) => {
    const kept = [...attrs.matchAll(ATTR)].map(([, k, v]) => `${k}="${v}"`);
    // Every attribute is kept, or the drawing changes (a line without x1 is a dot at 0,0).
    if (kept.length !== attrs.split('=').length - 1)
      throw new Error(`${name}: an attribute of <${tag}> could not be read`);
    return `<${tag} ${kept.join(' ')}/>`;
  });
  const leftover = inner
    .replace(ELEMENT, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (leftover) throw new Error(`${name}: unexpected content in the Lucide SVG: ${leftover}`);
  if (!elements.length) throw new Error(`${name}: no drawing elements`);
  return elements.join('');
}

/** Search words: ours first, then Lucide's tags, lowercase, each once, plain words only. */
function keywords(lucideName, extra = []) {
  const words = [...extra, ...(tags[lucideName] ?? [])]
    .map((w) => w.toLowerCase().replace(/['"]/g, '').trim())
    .filter((w) => /^[a-z0-9][a-z0-9 &.,:/()+-]*$/.test(w));
  return [...new Set(words)];
}

const groupKeys = new Set(groups.map((g) => g.key));
const indexPath = join(brand, 'icons/index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const own = index.filter((i) => !i.file.startsWith('icons/lucide/'));
const ownNames = new Set(own.map((i) => i.name));
const seen = new Set();
const files = new Map();
const entries = list.icons.map((icon) => {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(icon.name))
    throw new Error(`${icon.name}: not a valid icon name`);
  if (ownNames.has(icon.name)) throw new Error(`${icon.name}: already one of our own icons`);
  if (seen.has(icon.name)) throw new Error(`${icon.name}: listed twice`);
  if (!groupKeys.has(icon.group)) throw new Error(`${icon.name}: no picker group ${icon.group}`);
  seen.add(icon.name);
  // An icon can take its own name, with Lucide's under "from", so no two icons sound the same.
  const from = icon.from ?? icon.name;
  files.set(`${icon.name}.svg`, `${HEAD}${body(from)}</svg>\n`);
  return {
    name: icon.name,
    category: icon.group,
    keywords: keywords(from, icon.keywords),
    file: `icons/lucide/${icon.name}.svg`,
  };
});
const nextIndex = JSON.stringify([...own, ...entries], null, 1);

const stale = [];
let current = [];
try {
  current = readdirSync(outDir);
} catch {
  // not copied yet
}
for (const [file, svg] of files) {
  let was = '';
  try {
    was = readFileSync(join(outDir, file), 'utf8');
  } catch {
    // new icon
  }
  if (was !== svg) stale.push(`brand/icons/lucide/${file}`);
}
for (const file of current)
  if (!files.has(file)) stale.push(`brand/icons/lucide/${file} (not listed)`);
if (readFileSync(indexPath, 'utf8') !== nextIndex) stale.push('brand/icons/index.json');

if (check) {
  if (stale.length) {
    console.error(
      `out of date: ${stale.join(', ')}. Run pnpm --filter @familywise/ui brand:lucide`,
    );
    process.exit(1);
  }
} else {
  mkdirSync(outDir, { recursive: true });
  for (const file of current) if (!files.has(file)) rmSync(join(outDir, file));
  for (const [file, svg] of files) writeFileSync(join(outDir, file), svg);
  writeFileSync(indexPath, nextIndex);
  console.log(`${entries.length} Lucide icons, ${own.length + entries.length} in the set`);
}
