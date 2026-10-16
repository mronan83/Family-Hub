// No model name in a pull request (D-125): scripts/no-model-name.mjs's matcher, and its read of a
// branch's commits from a throwaway git repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchCommits, modelNames, problems } from './no-model-name.mjs';

test('[NFR-14] finds model names and IDs in any case', () => {
  assert.deepEqual(modelNames('Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'), ['Opus']);
  assert.deepEqual(modelNames('served by SONNET, then haiku'), ['SONNET', 'haiku']);
  assert.deepEqual(modelNames('fable 5.1'), ['fable']);
  assert.deepEqual(modelNames('model claude-opus-5-5 and Claude-Sonnet-4-6'), [
    'claude-opus-5-5',
    'Claude-Sonnet-4-6',
  ]);
});

test('[NFR-14] passes the agreed trailers and ordinary words', () => {
  const message = [
    '[CHR-04] Chores keep their order',
    '',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    'Claude-Session: https://claude.ai/code/session_01SnRY6cVd8x6ymKua5PCXvz',
  ].join('\n');
  assert.deepEqual(modelNames(message), []);
  assert.deepEqual(modelNames('opuses, sonnets and fables; claude-code; Claude 5'), []);
  assert.deepEqual(modelNames(undefined), []);
});

test('[NFR-14] reports each source that names a model, once per name', () => {
  assert.deepEqual(
    problems([
      { where: 'commit abc1234', text: 'Opus here, opus there, and claude-haiku-5-5' },
      { where: 'PR #9 title', text: 'WP-82: Goals' },
      { where: 'PR #9 body', text: null },
    ]),
    ['commit abc1234: Opus, opus, claude-haiku-5-5'],
  );
});

test('[NFR-14] reads every commit message on the branch and none from main', () => {
  const dir = mkdtempSync(join(tmpdir(), 'no-model-name-'));
  const git = (...args) =>
    execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '-q', '--allow-empty', '-m', 'old\n\nCo-Authored-By: Claude Opus 5.5 <x@y>');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'topic');
  git('commit', '-q', '--allow-empty', '-m', 'clean\n\nCo-Authored-By: Claude <x@y>');
  git('commit', '-q', '--allow-empty', '-m', 'second\n\nwritten by claude-sonnet-5-5');
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const commits = branchCommits();
    assert.equal(commits.length, 2);
    assert.deepEqual(
      problems(commits).map((p) => p.replace(/^commit \w+ /, '')),
      ['second: claude-sonnet-5-5'],
    );
  } finally {
    process.chdir(cwd);
  }
});
