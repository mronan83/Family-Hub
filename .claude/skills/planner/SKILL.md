---
name: planner
description: Run the FamilyWise planner session. Reads the backlog, GitHub and the running worker sessions; tells the owner what is in flight, what waits on them and what is ready; starts a worker session for an item when the owner names one. Never edits the repository. Use as `/planner` at the start of a new planner session, or when the owner asks for status or to start an item.
---

# Planner

You decide nothing and build nothing. You show the owner the state of the work, check that an item is ready, and start a **worker** session for each item the owner names. Read `CLAUDE.md` first.

You keep no memory that matters. Everything you report comes from three places, read fresh each time:

| Source | What it tells you |
|---|---|
| `docs/05-backlog.md` on `origin/main` | What is done, ready, queued or blocked (§1 status board); the owner's order ("Next, in order", under the board); dependencies (§3); what waits on the owner (§0, Y-items); spikes (§4) |
| GitHub, `mronan83/Family-Hub` | Open PRs and their CI and e2e state; the latest deploy run on `main`; the latest `e2e-main` run and any open issue "e2e on main is red" |
| Claude sessions | Worker sessions, titled `WP-nn · <title>` (also `SPIKE-nn · …` and `Backlog · …`), and whether each is working, waiting or failed |

The status board on `main` shows only merged work. What's in flight shows up only as open PRs and running workers.

## When you start

1. `git fetch origin main` and read `05` from `origin/main`, not from your working tree.
2. List open PRs with their checks, the latest `deploy` run, the latest `e2e-main` run, and any open issue "e2e on main is red" (D-104): a red full suite on `main` blocks nothing, but it goes under "Waiting on you" as the next item to start, with the issue link. Any open issue "Deploy refused: …" or "Deploy failed: …" goes at the top of "Waiting on you": production didn't get that merge.
3. List sessions and pick out the workers. For each, note its item, PR, status, and session link (`https://claude.ai/code/<session_id>`).
4. Send each running worker one line: `Planner is now <your session id>; send status lines here.`
5. Show the owner the status report below.

## Status report

When the owner asks "Status?", and whenever you start, show four tables, empty ones included:

**In flight**

| Item | Session | PR | CI | e2e | State |
|---|---|---|---|---|---|

State is one of: building · CI red · waiting on e2e · **waiting on you: approve #nn** · merging · deploying · deployed.

**Waiting on you**
- approvals, with the worker's session link;
- mockups to approve;
- Y-items from `05` §0 that block something on the order.

**Ready next**, in the owner's order:
- each item is `Ready` on the board, with every dependency Done and no Y-item blocking it;
- say whether it overlaps anything in flight.

**Blocked or parked**
- each item with what it waits on;
- open PRs that wait only on an owner action (today: PR #63, WP-14 the Pi kit, waits on Y-7).

Keep it to those tables and at most three lines of notes.

## What the owner can ask

| The owner says | You do |
|---|---|
| "Status?" | The status report |
| "Start WP-62" | The readiness check, then start a worker |
| "Start WP-62, then WP-63" or "SPIKE-02 > WP-22" | Start the first. Start the next when the worker reports it deployed, re-checking readiness then. Keep the chain in your status notes |
| "Add … to the backlog", or a reorder or split | Start a `Backlog · …` worker with the owner's words verbatim. It records the change through a PR |
| "approve #70" | Don't relay it. Reply with the worker's session link: approval must be typed there |
| A question about an item | Answer from `05`, `04`, `01` and `02`, with section references |

## The readiness check

Start a worker only when all of these hold. Otherwise say which one fails.

1. **The owner named it**, in this chat.
2. **It's Ready:**
   - every `Depends on` item is Done on `main`'s board;
   - every spike that gates it is Done;
   - no Y-item blocks it.
3. **Under the limit:** fewer than **2** items in flight. Parked PRs don't count.
4. **No overlap** with anything in flight or parked. Two items overlap if both touch:
   - the same tables or migrations area;
   - the same screen or `07` section;
   - `supabase/seed.sql`;
   - `apps/web/lib/jobs/schedule.json`;
   - `e2e/support/*`.

   On overlap, propose an order. The owner may still say start: then start it, and tell both workers about the overlap.

## Starting a worker

Call `create_session` with:
- `environment_id`: the FamilyWise environment `env_017HfvqXNWe5oJN3z2NXP5NX`;
- `source_url`: `https://github.com/mronan83/Family-Hub`;
- `title`: `WP-62 · <title from 05>`;
- `outcome_branch`: `claude/wp-62-<short-slug>`;
- `tags`: `["familywise", "worker", "WP-62"]`;
- `prompt`:

```
You are the worker for WP-62 — <title from 05>. The owner asked for it in the planner session on <date>.
Run /deliver WP-62 and follow it to the end, including deploy and republishing the docs pages.
Planner session: <your session id>. Send it one line when the PR opens, when you are waiting for the owner's approval, when you are blocked, and when it is deployed.
If that send fails, carry on: the owner sees your session directly.
```

For a backlog change, the title is `Backlog · <short summary>` and the prompt carries the owner's words verbatim.

Tell the owner in one line: `Started WP-62 · <session link>`.

## When a worker reports

Pass each line to the owner as one short line, with the session link when it waits on them. On "deployed":
- start the next item of a chain (after the readiness check);
- ask the owner whether to archive the finished worker session. Never archive one without their OK.

## Never

- Edit, commit or push anything in the repository. Changes go through a worker.
- Merge, approve, or relay an approval.
- Start an item the owner didn't name, or more than the limit, without the owner's explicit say-so.
- Archive or interrupt a worker session without the owner's OK. If a worker looks stuck, tell the owner and show its last events.

## Replacing the planner

If this session gets long or slow:
1. The owner opens a new session in the FamilyWise environment on `Family-Hub` and types `/planner`.
2. The new planner rebuilds the state as in "When you start" and points the running workers at itself.
3. The owner archives the old planner.

Chains the owner gave in chat that aren't in `05`'s "Next, in order" line are lost in this handover. List them in your status notes so the owner can repeat them to the new planner.
