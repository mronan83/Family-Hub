## Item

WP-__ — <!-- title from docs/05-backlog.md; or SPIKE-__, or Backlog: … -->

**Worker session:** <!-- link; the owner approves there with `approve #nn` (D-90) -->

**Requirements:** <!-- e.g. CHR-04, NFR-06 -->

## What changed

-

## Test cases and catalogue

<!-- The test cases this item adds (08 §6, D-107): ID, case, layer, and the test that proves each. Then the catalogue's diff: tests, known gaps and new gaps before and after (pnpm trace's last line). -->

| Case | Test case | Layer | Proved by |
|---|---|---|---|
| | | | |

**Catalogue:** tests __ → __ · known gaps __ → __ · new gaps 0

## Docs updated in this PR

- [ ] `docs/05-backlog.md` status board says Done, with an As-built note
- [ ] Affected artifacts (`01` architecture, `02` data model, `03` stories, `04` requirements) and a row in `04` §I
- [ ] `docs/07-user-guide.md` for anything a parent or child can see (and `pnpm guide:shots` if a screen changed)
- [ ] Test cases in the item's `05` §5 section, each with a test; `08` §9 and `04` §B regenerated (`check_traceability.py --fix`)
- [ ] `python3 docs/check_traceability.py --docs docs --tests .` passes

## Verification

- [ ] CI gates green (checks, database, docs, build)
- [ ] e2e green on the preview (results in a comment: passed, retries, minutes, latency)
- [ ] Anything deferred is listed below

## Deferred

-
