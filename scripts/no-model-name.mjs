#!/usr/bin/env node
// No model name in a pull request (01 §9.3, D-125, CLAUDE.md "Never"). Fails when a commit message on
// the branch, or the pull request's title or body, names a model or carries a model ID. The co-author
// line, if any, is `Co-Authored-By: Claude <noreply@anthropic.com>`. Older commits on main keep their
// trailers; main is never checked or rewritten. Tested by no-model-name.test.mjs.
//
// On a push: every commit in origin/main..HEAD, plus the title and body of the branch's open pull
// request (GITHUB_TOKEN, GITHUB_REPOSITORY). On a pull_request event: the title and body from the
// event payload, so an edit to either is checked too.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MODEL_NAME = /\b(?:opus|sonnet|haiku|fable)\b|claude-[a-z]+-[0-9][\w.-]*/gi;

/** Every model name or ID in a text, as written. */
export function modelNames(text) {
  return [...(text ?? '').matchAll(MODEL_NAME)].map((m) => m[0]);
}

/** One problem line per source (`{ where, text }`) that names a model; none when all are clean. */
export function problems(sources) {
  return sources.flatMap(({ where, text }) => {
    const found = modelNames(text);
    return found.length ? [`${where}: ${[...new Set(found)].join(', ')}`] : [];
  });
}

export function branchCommits(base = 'origin/main') {
  const out = execFileSync('git', ['log', '--format=%h %s%n%B%x00', `${base}..HEAD`], {
    encoding: 'utf8',
  });
  return out
    .split('\0')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => ({ where: `commit ${c.slice(0, c.indexOf('\n'))}`, text: c }));
}

function prSources(pr) {
  return pr
    ? [
        { where: `PR #${pr.number} title`, text: pr.title },
        { where: `PR #${pr.number} body`, text: pr.body },
      ]
    : [];
}

async function openPullRequest(env) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_REF_NAME: branch } = env;
  if (!token || !repo) return null;
  const owner = repo.split('/')[0];
  const url = `https://api.github.com/repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the branch's pull request`);
  return (await res.json())[0] ?? null;
}

async function main(env = process.env) {
  let sources;
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    sources = prSources(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request);
  } else if ((env.GITHUB_REF_NAME ?? '') === 'main') {
    console.log('main: not checked (each merge is checked on its pull request)');
    return 0;
  } else {
    sources = [...branchCommits(), ...prSources(await openPullRequest(env))];
  }
  const found = problems(sources);
  for (const p of found) console.log(`::error::Model name in ${p}`);
  console.log(`${sources.length} texts checked, ${found.length} name a model`);
  return found.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
