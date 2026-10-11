#!/usr/bin/env python3
"""check_traceability.py — validate and regenerate the FamilyWise traceability docs.

Source of truth:
  04-requirements-traceability.md  (register + matrix)  -> requirement IDs
  03-user-stories.md               (**Reqs:** lines)    -> story -> requirement links
  05-backlog.md                    (**Reqs:** lines)    -> work package -> requirement links
  01-technical-architecture.md     (component table)    -> valid component IDs
  07-user-guide.md                 (<!-- covers: --> lines, exclusion table) -> stories the guide covers

Checks (errors fail the run):
  * register IDs are unique; every requirement has >= 1 story and >= 1 work package
  * every story and work package lists >= 1 requirement and every referenced ID exists
  * matrix rows == register rows; Stories and Work packages columns match 03/05; components are valid
  * no unresolved {{placeholders}}
  * backlog: every `Depends on` work package exists, sits in the same or an earlier milestone
    (P0 < P1a < P1b < P1c < P1d < P2 < P3), and forms no cycle; the dependency diagram's edges
    equal the declared dependencies; the status board lists every work package with matching
    milestone, size and dependencies
  * user guide (D-68): every story linked (by a shared requirement) to a work package whose status
    is Done in 05 is covered by a section of 07 (`<!-- covers: US-301 US-305 -->` on the line after
    the section's heading) or listed, with a reason, in 07's exclusion table (between
    `<!-- guide-exclusions -->` and `<!-- /guide-exclusions -->`); covered and excluded IDs exist,
    each exclusion gives a reason, and no story is both covered and excluded
Warnings:
  * a requirement's earliest story or work package is scheduled after the requirement's phase
  * (with --tests DIR) requirements with no test referencing their ID
  * a story excluded from the user guide that no Done work package builds yet (drop the exclusion)

Usage:
  python check_traceability.py --docs .                 # validate (CI)
  python check_traceability.py --docs . --fix           # regenerate Stories and Work packages columns + sections C and D
  python check_traceability.py --docs . --tests . --phase 1 [--strict-tests]
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

REQ = r"(?:ACC|DEV|CHR|RWD|CAL|SCH|MEAL|MENU|BRD|PTS|NFR)-\d{2}"
REQ_RE = re.compile(r"\b" + REQ + r"\b")
REQ_FULL = re.compile(r"^" + REQ + r"$")
STORY_HEAD = re.compile(r"^###\s+(US-\d+)\s+—\s+(.*)$")
WP_HEAD = re.compile(r"^###\s+(WP-\d+)\s+—\s+(.*)$")
PHASE_RE = re.compile(r"\*\*Phase:\*\*\s*P(\d)")
MILESTONE_RE = re.compile(r"\*\*Phase:\*\*\s*(P\d[a-d]?)")
SIZE_RE = re.compile(r"\*\*Size:\*\*\s*([SML])\b")
DEPS_RE = re.compile(r"\*\*Depends on:\*\*\s*([^·]*)")
WP_RE = re.compile(r"\bWP-\d{2}\b")
EDGE_RE = re.compile(r"WP(\d{2})(?:\[[^\]]*\])?\s*-->\s*WP(\d{2})")
MILESTONE_ORDER = ["P0", "P1a", "P1b", "P1c", "P1d", "P2", "P3"]
STORY_RE = re.compile(r"\bUS-\d{3,4}\b")
COVERS_RE = re.compile(r"<!--\s*covers:(.*?)-->")
EXCLUSIONS_RE = re.compile(r"<!--\s*guide-exclusions\s*-->(.*?)<!--\s*/guide-exclusions\s*-->", re.S)
FILES = {
    "arch": "01-technical-architecture.md",
    "stories": "03-user-stories.md",
    "wps": "05-backlog.md",
    "reqs": "04-requirements-traceability.md",
    "guide": "07-user-guide.md",
}
SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "build", ".turbo"}


def natural(s: str):
    return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", s)]


def section_bounds(lines: list[str], prefix: str):
    start = next((i for i, l in enumerate(lines) if l.startswith(prefix)), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    return start, end


def split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def table_rows(lines: list[str], bounds):
    rows = []
    if not bounds:
        return rows
    s, e = bounds
    for i in range(s, e):
        if lines[i].startswith("|"):
            cells = split_row(lines[i])
            if cells and REQ_FULL.match(cells[0]):
                rows.append((i, cells))
    return rows


def parse_items(text: str, head=STORY_HEAD):
    stories: "OrderedDict[str, dict]" = OrderedDict()
    cur = None
    for line in text.splitlines():
        m = head.match(line)
        if m:
            cur = m.group(1)
            stories[cur] = {"title": m.group(2), "reqs": [], "phase": None, "milestone": None, "size": None, "deps": []}
            continue
        if line.startswith("### ") and not m:
            cur = None
        if cur and "**Reqs:**" in line:
            stories[cur]["reqs"] = REQ_RE.findall(line.split("**Reqs:**", 1)[1])
            pm = PHASE_RE.search(line)
            if pm:
                stories[cur]["phase"] = int(pm.group(1))
            mm = MILESTONE_RE.search(line)
            if mm:
                stories[cur]["milestone"] = mm.group(1)
            sm = SIZE_RE.search(line)
            if sm:
                stories[cur]["size"] = sm.group(1)
            dm = DEPS_RE.search(line)
            if dm:
                stories[cur]["deps"] = WP_RE.findall(dm.group(1))
    return stories


def check_backlog(wps, wps_text: str, errors: list[str]) -> None:
    """Dependencies, milestone order, diagram edges and status board of 05-backlog.md."""
    rank = {m: i for i, m in enumerate(MILESTONE_ORDER)}
    for wid, w in wps.items():
        if w["milestone"] not in rank:
            errors.append(f"{wid}: milestone '{w['milestone']}' is not one of {', '.join(MILESTONE_ORDER)}")
            continue
        for d in w["deps"]:
            if d == wid:
                errors.append(f"{wid}: depends on itself")
            elif d not in wps:
                errors.append(f"{wid}: depends on unknown work package {d}")
            elif wps[d]["milestone"] in rank and rank[wps[d]["milestone"]] > rank[w["milestone"]]:
                errors.append(f"{wid} ({w['milestone']}) depends on {d} in a later milestone ({wps[d]['milestone']})")
    state: dict[str, int] = {}

    def visit(n: str, path: list[str]) -> None:
        state[n] = 1
        for d in wps[n]["deps"]:
            if d not in wps:
                continue
            if state.get(d) == 1:
                errors.append("dependency cycle: " + " -> ".join(path + [n, d]))
            elif not state.get(d):
                visit(d, path + [n])
        state[n] = 2

    for n in wps:
        if not state.get(n):
            visit(n, [])
    declared = {(d, wid) for wid, w in wps.items() for d in w["deps"]}
    drawn = {(f"WP-{a}", f"WP-{b}") for a, b in EDGE_RE.findall(wps_text)}
    if drawn:
        for a, b in sorted(declared - drawn):
            errors.append(f"diagram is missing edge {a} --> {b} (declared in {b})")
        for a, b in sorted(drawn - declared):
            errors.append(f"diagram edge {a} --> {b} is not declared in {b}'s Depends on")
    board = {}
    for line in wps_text.splitlines():
        if line.startswith("| WP-"):
            cells = split_row(line)
            if len(cells) >= 6:
                board[cells[0]] = cells
    if board:
        for wid, w in wps.items():
            row = board.get(wid)
            if not row:
                errors.append(f"{wid}: missing from the status board")
                continue
            if row[2] != w["milestone"]:
                errors.append(f"{wid}: status board milestone '{row[2]}' != section '{w['milestone']}'")
            if row[3] != w["size"]:
                errors.append(f"{wid}: status board size '{row[3]}' != section '{w['size']}'")
            if sorted(WP_RE.findall(row[4])) != sorted(w["deps"]):
                errors.append(f"{wid}: status board depends '{row[4]}' != section '{', '.join(w['deps']) or '—'}'")
        for wid in board:
            if wid not in wps:
                errors.append(f"{wid}: on the status board but has no section")


def board_statuses(wps_text: str) -> dict[str, str]:
    """Each work package's Status cell on 05's status board."""
    out: dict[str, str] = {}
    for line in wps_text.splitlines():
        if line.startswith("| WP-"):
            cells = split_row(line)
            if len(cells) >= 6:
                out[cells[0]] = cells[5]
    return out


def built_stories(stories, wps, wps_text: str) -> dict[str, list[str]]:
    """Stories linked, by a shared requirement, to a work package whose status is Done in 05."""
    status = board_statuses(wps_text)
    done = {w for w, s in status.items() if s.startswith("Done")}
    out: dict[str, list[str]] = {}
    for sid, s in stories.items():
        linked = sorted((w for w in wps if w in done and set(wps[w]["reqs"]) & set(s["reqs"])), key=natural)
        if linked:
            out[sid] = linked
    return out


def check_guide(guide_text: str, stories, built: dict[str, list[str]], errors: list[str], warnings: list[str]):
    """[D-68] Every built story is covered by a section of 07, or excluded there with a reason.

    Returns (built stories covered, built stories excluded)."""
    lines = guide_text.splitlines()
    covered: dict[str, int] = defaultdict(int)
    fence = False
    for i, line in enumerate(lines):
        if line.startswith("```"):
            fence = not fence
        if fence:
            continue
        for m in COVERS_RE.finditer(line):
            ids = STORY_RE.findall(m.group(1))
            if not ids or STORY_RE.sub("", m.group(1)).strip():
                errors.append(f"07 line {i + 1}: a covers line lists story IDs only, like <!-- covers: US-301 US-305 -->")
            if i == 0 or not lines[i - 1].startswith("#"):
                errors.append(f"07 line {i + 1}: a covers line goes on the line right after its section's heading")
            for sid in ids:
                if sid not in stories:
                    errors.append(f"07 line {i + 1}: covers unknown story {sid}")
                covered[sid] += 1

    excluded: dict[str, str] = {}
    blocks = EXCLUSIONS_RE.findall(guide_text)
    if len(blocks) != 1:
        errors.append("07: needs one exclusion table between <!-- guide-exclusions --> and <!-- /guide-exclusions -->")
    for block in blocks:
        for line in block.splitlines():
            if not line.startswith("|"):
                continue
            cells = split_row(line)
            if not cells or not STORY_RE.fullmatch(cells[0]):
                continue
            sid, reason = cells[0], (cells[1] if len(cells) > 1 else "").strip()
            if sid not in stories:
                errors.append(f"07: excludes unknown story {sid}")
            if sid in excluded:
                errors.append(f"07: {sid} is excluded twice")
            if len(reason) < 10:
                errors.append(f"07: the exclusion of {sid} needs a reason")
            excluded[sid] = reason

    for sid in excluded:
        if covered.get(sid):
            errors.append(f"07: {sid} is both covered by a section and excluded; keep one")
        elif sid in stories and sid not in built:
            warnings.append(f"07: {sid} is excluded, but no Done work package builds it yet; drop the exclusion")
    for sid, linked in built.items():
        if not covered.get(sid) and sid not in excluded:
            errors.append(
                f"07: {sid} is built ({', '.join(linked)} Done) but no section of the user guide covers it: "
                f"add <!-- covers: {sid} --> under the heading of the section that explains it, or list it "
                "in 07's exclusion table with a reason"
            )
    return sum(1 for s in built if covered.get(s)), sum(1 for s in built if s in excluded)


def coverage_md(register, stories, story_map, wps, wp_map) -> list[str]:
    phases = sorted({r["phase"] for r in register.values()})
    out = ["| Phase | Must | Should | Could | Total |", "|---|---|---|---|---|"]
    totals = [0, 0, 0]
    for p in phases:
        row = [sum(1 for r in register.values() if r["phase"] == p and r["pri"] == k) for k in "MSC"]
        totals = [a + b for a, b in zip(totals, row)]
        out.append(f"| P{p} | {row[0]} | {row[1]} | {row[2]} | {sum(row)} |")
    out.append(f"| **Total** | **{totals[0]}** | **{totals[1]}** | **{totals[2]}** | **{sum(totals)}** |")
    covered = sum(1 for r in register if story_map.get(r))
    wp_covered = sum(1 for r in register if wp_map.get(r))
    by_phase = defaultdict(int)
    for s in stories.values():
        by_phase[s["phase"]] += 1
    phase_txt = " · ".join(f"P{p}: {n}" for p, n in sorted(by_phase.items(), key=lambda kv: (kv[0] is None, kv[0])))
    out += [
        "",
        f"- Requirements: **{len(register)}** · with at least one story: **{covered}** · stories: **{len(stories)}** ({phase_txt}).",
        f"- With at least one work package: **{wp_covered}** · work packages: **{len(wps)}**.",
        "- Generated by `check_traceability.py --fix`; do not edit by hand.",
    ]
    return out


def component_md(comp_order, matrix_cells) -> list[str]:
    idx = {c: [] for c in comp_order}
    for rid, cells in matrix_cells.items():
        for c in (x.strip() for x in cells[3].split(",")):
            if c in idx:
                idx[c].append(rid)
    out = ["| Component | Requirements |", "|---|---|"]
    for c in comp_order:
        reqs = ", ".join(sorted(idx[c], key=natural)) or "—"
        out.append(f"| `{c}` | {reqs} |")
    out += ["", "`all` (NFR-12) applies to every component. Generated by `check_traceability.py --fix`."]
    return out


def replace_section(lines: list[str], prefix: str, content: list[str]) -> None:
    b = section_bounds(lines, prefix)
    if not b:
        return
    s, e = b
    sep = next((j for j in range(s + 1, e) if lines[j].strip() == "---"), e)
    lines[s + 1 : sep] = [""] + content + [""]


def scan_tests(root: Path) -> set[str]:
    found: set[str] = set()
    for p in root.rglob("*"):
        if not p.is_file() or any(part in SKIP_DIRS for part in p.parts):
            continue
        n = p.name
        if ".test." in n or ".spec." in n:
            try:
                found.update(REQ_RE.findall(p.read_text(encoding="utf-8", errors="ignore")))
            except OSError:
                pass
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--docs", default=".", help="directory containing the docs")
    ap.add_argument("--fix", action="store_true", help="regenerate Stories and Work packages columns and sections C/D")
    ap.add_argument("--tests", help="directory to scan for *.test.* / *.spec.* files referencing requirement IDs")
    ap.add_argument("--phase", type=int, default=0, help="with --tests: require tests for requirements with phase <= N")
    ap.add_argument("--strict-tests", action="store_true", help="treat missing tests as errors")
    args = ap.parse_args()

    docs = Path(args.docs)
    arch_text = (docs / FILES["arch"]).read_text(encoding="utf-8")
    stories_text = (docs / FILES["stories"]).read_text(encoding="utf-8")
    wps_text = (docs / FILES["wps"]).read_text(encoding="utf-8")
    req_path = docs / FILES["reqs"]
    req_text = req_path.read_text(encoding="utf-8")
    req_lines = req_text.splitlines()

    errors: list[str] = []
    warnings: list[str] = []

    comp_order = list(OrderedDict.fromkeys(re.findall(r"^\|\s*`([A-Z]+)`\s*\|", arch_text, re.M)))
    comps = set(comp_order)
    stories = parse_items(stories_text)
    wps = parse_items(wps_text, WP_HEAD)

    ra = section_bounds(req_lines, "## A.")
    rb = section_bounds(req_lines, "## B.")
    if not ra or not rb:
        print("ERROR: sections '## A.' and '## B.' not found in 04", file=sys.stderr)
        return 2

    register: "OrderedDict[str, dict]" = OrderedDict()
    for _, cells in table_rows(req_lines, ra):
        if len(cells) < 5:
            errors.append(f"{cells[0]}: register row needs 5 columns")
            continue
        rid = cells[0]
        if rid in register:
            errors.append(f"{rid}: duplicate in register")
        register[rid] = {"text": cells[1], "pri": cells[2], "phase": int(cells[3].lstrip("P")), "source": cells[4]}

    story_map: dict[str, list[str]] = defaultdict(list)
    for sid, s in stories.items():
        if not s["reqs"]:
            errors.append(f"{sid}: no **Reqs:** line or no requirement IDs")
        for r in s["reqs"]:
            if r not in register:
                errors.append(f"{sid}: references unknown requirement {r}")
            else:
                story_map[r].append(sid)

    wp_map: dict[str, list[str]] = defaultdict(list)
    for wid, w in wps.items():
        if not w["reqs"]:
            errors.append(f"{wid}: no **Reqs:** line or no requirement IDs")
        for r in w["reqs"]:
            if r not in register:
                errors.append(f"{wid}: references unknown requirement {r}")
            else:
                wp_map[r].append(wid)

    check_backlog(wps, wps_text, errors)

    built = built_stories(stories, wps, wps_text)
    guide_path = docs / FILES["guide"]
    if guide_path.exists():
        guide_covered, guide_excluded = check_guide(
            guide_path.read_text(encoding="utf-8"), stories, built, errors, warnings
        )
    else:
        errors.append(f"{FILES['guide']} is missing: the user guide covers every built story (D-68)")
        guide_covered = guide_excluded = 0

    for rid, meta in register.items():
        if not story_map.get(rid):
            errors.append(f"{rid}: no story covers this requirement")
        else:
            phases = [stories[s]["phase"] for s in story_map[rid] if stories[s]["phase"] is not None]
            if phases and min(phases) > meta["phase"]:
                warnings.append(f"{rid}: requirement phase P{meta['phase']} but earliest story is P{min(phases)}")
        if not wp_map.get(rid):
            errors.append(f"{rid}: no work package covers this requirement")
        else:
            wphases = [wps[w]["phase"] for w in wp_map[rid] if wps[w]["phase"] is not None]
            if wphases and min(wphases) > meta["phase"]:
                warnings.append(f"{rid}: requirement phase P{meta['phase']} but earliest work package is P{min(wphases)}")

    new_lines = list(req_lines)
    matrix_cells: "OrderedDict[str, list[str]]" = OrderedDict()
    seen: set[str] = set()
    for i, cells in table_rows(req_lines, rb):
        rid = cells[0]
        seen.add(rid)
        if len(cells) != 6:
            errors.append(f"{rid}: matrix row needs 6 columns (Req, Stories, Work packages, Components, Entities, Verification)")
            continue
        if rid not in register:
            errors.append(f"{rid}: in matrix but not in register")
        for col, name, mp in ((1, "Stories", story_map), (2, "Work packages", wp_map)):
            derived = ", ".join(sorted(mp.get(rid, []), key=natural))
            if cells[col] != derived:
                if args.fix:
                    cells[col] = derived
                    new_lines[i] = "| " + " | ".join(cells) + " |"
                else:
                    errors.append(f"{rid}: {name} column out of date (expected '{derived}', found '{cells[col]}') — run --fix")
        for c in (x.strip() for x in cells[3].split(",")):
            if c not in comps and c not in ("all", "—"):
                errors.append(f"{rid}: unknown component '{c}' (see 01 component table)")
        matrix_cells[rid] = cells
    for rid in register:
        if rid not in seen:
            errors.append(f"{rid}: missing from traceability matrix")

    if args.fix:
        replace_section(new_lines, "## C.", coverage_md(register, stories, story_map, wps, wp_map))
        replace_section(new_lines, "## D.", component_md(comp_order, matrix_cells))
        out = "\n".join(new_lines) + ("\n" if req_text.endswith("\n") else "")
        if out != req_text:
            req_path.write_text(out, encoding="utf-8")
            print(f"updated {req_path.name}")
        # re-check placeholders on the regenerated text
        req_text = out
    if re.search(r"\{\{(?:S:[A-Z]+-\d{2}|COVERAGE|COMPONENT_INDEX)\}\}", req_text):
        errors.append("unresolved {{placeholders}} in 04 — run with --fix")

    if args.tests:
        tested = scan_tests(Path(args.tests))
        for rid, cells in matrix_cells.items():
            needs_test = any(v in cells[5] for v in ("U", "DB", "INT", "E2E"))
            if needs_test and register[rid]["phase"] <= args.phase and rid not in tested:
                (errors if args.strict_tests else warnings).append(f"{rid}: no test references this ID")

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    print(
        f"\n{len(register)} requirements · {len(stories)} stories · {len(wps)} work packages · "
        f"user guide: {guide_covered} of {len(built)} built stories covered, {guide_excluded} excluded · "
        f"{len(errors)} error(s) · {len(warnings)} warning(s)"
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
