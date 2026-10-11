#!/usr/bin/env node
// Copies the user guide's pictures (docs/guide/img) into the web app's public folder, where Help
// (/help, D-72) shows them. apps/web runs this before dev and build; the copy is not committed.
//
//   node scripts/guide/public.mjs <dir>    e.g. apps/web/public
import { cpSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/guide/public.mjs <dir>');
const out = join(resolve(dir), 'guide/img');
rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'docs/guide/img'), out, { recursive: true });
