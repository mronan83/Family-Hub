// Components use role tokens, never raw hex (06 §4, §11). Colors live only in
// brand/familywise-tokens.css and the files generated from it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCANNED = ['packages/ui/src', 'apps/web/app'];
const SKIPPED = new Set(['packages/ui/src/generated']);
const CSS_HEX = /#[0-9a-fA-F]{3,8}\b/;
// In code, only a hex color inside a string literal counts (not an anchor such as '#main').
const CODE_HEX = /['"`]#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})['"`]/;

function files(dir: string): string[] {
  if (SKIPPED.has(relative(root, dir))) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|tsx?)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('raw colors', () => {
  it('[NFR-13] no raw hex color outside the tokens file', () => {
    const offenders: string[] = [];
    for (const file of SCANNED.flatMap((d) => files(join(root, d)))) {
      const pattern = file.endsWith('.css') ? CSS_HEX : CODE_HEX;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (pattern.test(line.replace(/\/\*.*?\*\/|\/\/.*$/g, ''))) {
            offenders.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('[NFR-13] the guard catches a raw color', () => {
    expect(CSS_HEX.test('color: #0F766E;')).toBe(true);
    expect(CODE_HEX.test("style={{ color: '#fff' }}")).toBe(true);
    expect(CODE_HEX.test("href='#main'")).toBe(false);
  });
});
