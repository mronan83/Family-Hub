#!/usr/bin/env bash
# Opens one GitHub issue per title, or comments on the open one that already has it (D-108): the
# deploy workflow's "Deploy refused: <commit>" and e2e's "E2E red on main: <spec>". Never closes one.
# Usage: open-issue.sh TITLE BODY. Reads REPO; calls `gh` (GH_TOKEN). Tested by open-issue.test.mjs.
set -euo pipefail

title=$1
body=$2
number=$(gh issue list --repo "$REPO" --state open --limit 500 --json number,title \
  | jq -r --arg t "$title" '[.[] | select(.title == $t)][0].number // empty')
if [ -n "$number" ]; then
  gh issue comment "$number" --repo "$REPO" --body "$body"
  echo "Updated issue #$number: $title"
else
  gh issue create --repo "$REPO" --title "$title" --body "$body"
  echo "Opened issue: $title"
fi
