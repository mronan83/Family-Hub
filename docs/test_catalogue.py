"""test_catalogue.py — read every test's name and trace it to the docs (NFR-18, `08` §9).

Used by check_traceability.py. Reads the tests in four layers:
  Unit  Vitest and node:test (`*.test.ts`, `*.test.tsx`, `*.test.mjs`) outside `e2e/`
  DB    pgTAP (`supabase/tests/*.test.sql`): each assertion, named by its description
  UI    the UI suite (`e2e/ui/*.spec.ts`), made-up data, no shared database
  E2E   end to end on the preview (`e2e/tests/*.spec.ts`)

A test traces to every ID in its name, and in the names of the `describe` blocks around it:
requirements (`CHR-04`), user stories (`US-707`), backlog items (`WP-78`) and test cases
(`MEAL-11-a`, a requirement plus a letter, written in the item's §5 section of `05`).

Builds the generated Test catalogue (08 §9), the Tests column of 04 §B and the gaps CI compares
with the known gaps in `known-test-gaps.txt`.
"""
from __future__ import annotations

import re
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

REQ = r"(?:ACC|DEV|CHR|RWD|CAL|SCH|MEAL|MENU|BRD|PTS|NFR)-\d{2}"
CASE_RE = re.compile(r"\b(" + REQ + r")-([a-z])\b")
REQ_ONLY_RE = re.compile(r"\b(" + REQ + r")\b(?!-[a-z]\b)")
STORY_RE = re.compile(r"\bUS-\d{3,4}\b")
ITEM_RE = re.compile(r"\b(?:WP|SPIKE)-\d{2}\b")
CASE_FULL = re.compile(r"^" + REQ + r"-[a-z]$")
WP_HEAD = re.compile(r"^###\s+((?:WP|SPIKE)-\d{2})\s+—\s+(.*)$")

LAYERS = ("Unit", "DB", "UI", "E2E")
LAYER_SHORT = {"Unit": "U", "DB": "DB", "UI": "UI", "E2E": "E2E"}
AREAS = OrderedDict(
    [
        ("CHR", "Chores"),
        ("PTS", "Points"),
        ("RWD", "Goals and rewards"),
        ("CAL", "Calendar"),
        ("SCH", "School year"),
        ("MEAL", "Meals and lunch"),
        ("MENU", "School menu"),
        ("BRD", "Board"),
        ("DEV", "Boards and devices"),
        ("ACC", "Admin and members"),
        ("NFR", "Platform"),
    ]
)
SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "build", ".turbo", "test-results", "playwright-report"}
JS_TEST_FILE = re.compile(r"\.(?:test|spec)\.(?:ts|tsx|mjs|js)$")

# A call to describe/it/test whose first argument is a string. Modifiers after a dot pick the kind.
JS_CALL = re.compile(
    r"(?<![\w.$])(describe|it|test)((?:\.\w+)*)\(\s*(['\"`])((?:\\.|(?!\3)[\s\S])*?)\3",
)
JS_EACH = re.compile(r"(?<![\w.$])(describe|it|test)((?:\.\w+)*)\.each\s*\(")
JS_TITLE = re.compile(r"\s*\(\s*(['\"`])((?:\\.|(?!\1)[\s\S])*?)\1")
NOT_A_TEST = {"skip", "step", "beforeAll", "afterAll", "beforeEach", "afterEach", "use", "setTimeout",
              "extend", "info", "expect", "todo", "fixme"}
PG_NOT_A_TEST = {"plan", "finish", "no_plan", "set_config", "diag", "pass_through", "count", "exists"}


def layer_of(rel: str) -> str:
    if rel.endswith(".sql"):
        return "DB"
    if rel.startswith("e2e/ui/"):
        return "UI"
    if rel.startswith("e2e/"):
        return "E2E"
    return "Unit"


def _line_indent(text: str, pos: int) -> int:
    start = text.rfind("\n", 0, pos) + 1
    line = text[start:pos]
    return len(line) - len(line.lstrip(" \t"))


def _clean(name: str) -> str:
    return re.sub(r"\s+", " ", name.replace("\\'", "'").replace('\\"', '"')).strip()


def _js_close(text: str, open_pos: int) -> int:
    """The index of the bracket that closes the one at open_pos, skipping strings and comments."""
    depth, i, n = 0, open_pos, len(text)
    while i < n:
        ch = text[i]
        if ch in "'\"`":
            i += 1
            while i < n and text[i] != ch:
                i += 2 if text[i] == "\\" else 1
        elif text.startswith("//", i):
            i = text.find("\n", i)
            i = n if i < 0 else i
            continue
        elif text.startswith("/*", i):
            i = text.find("*/", i)
            i = n if i < 0 else i + 2
            continue
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _js_calls(text: str):
    """(start, base, modifiers, title) for each describe/it/test call with a title; `.each(table)(title)` too."""
    calls = [(m.start(), m.group(1), m.group(2), m.group(4)) for m in JS_CALL.finditer(text)]
    for m in JS_EACH.finditer(text):
        close = _js_close(text, m.end() - 1)
        t = JS_TITLE.match(text, close + 1) if close > 0 else None
        if t:
            calls.append((m.start(), m.group(1), m.group(2) + ".each", t.group(2)))
    return sorted(calls)


def js_tests(rel: str, text: str) -> list[dict]:
    out = []
    stack: list[tuple[int, str]] = []  # (indent, title) of the describe blocks around this point
    for start, base, mods, raw in _js_calls(text):
        name = _clean(raw)
        parts = [p for p in mods.split(".") if p]
        indent = _line_indent(text, start)
        while stack and stack[-1][0] >= indent:
            stack.pop()
        if base == "describe" or "describe" in parts:
            stack.append((indent, name))
            continue
        if any(p in NOT_A_TEST for p in parts):
            continue
        context = " ".join(t for _, t in stack)
        line = text.count("\n", 0, start) + 1
        out.append({"file": rel, "layer": layer_of(rel), "name": name, "context": context, "line": line})
    return out


DOLLAR = re.compile(r"\$[A-Za-z_]*\$")


def _matching_paren(text: str, open_pos: int) -> int:
    depth, i, n = 0, open_pos, len(text)
    while i < n:
        ch = text[i]
        dq = DOLLAR.match(text, i) if ch == "$" else None
        if dq:
            end = text.find(dq.group(0), dq.end())
            i = n if end < 0 else end + len(dq.group(0))
            continue
        if ch == "'":
            i += 1
            while i < n and not (text[i] == "'" and text[i + 1 : i + 2] != "'"):
                i += 2 if text[i] == "'" else 1
        elif ch == "-" and text[i + 1 : i + 2] == "-":
            nl = text.find("\n", i)
            i = n if nl < 0 else nl
            continue
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _top_args(body: str) -> list[str]:
    args, depth, cur, i, n = [], 0, [], 0, len(body)
    while i < n:
        ch = body[i]
        dq = DOLLAR.match(body, i) if ch == "$" else None
        if dq:
            end = body.find(dq.group(0), dq.end())
            j = n if end < 0 else end + len(dq.group(0))
            cur.append(body[i:j])
            i = j
            continue
        if ch == "'":
            j = i + 1
            while j < n and not (body[j] == "'" and body[j + 1 : j + 2] != "'"):
                j += 2 if body[j] == "'" else 1
            cur.append(body[i : j + 1])
            i = j + 1
            continue
        if ch == "-" and body[i + 1 : i + 2] == "-":
            nl = body.find("\n", i)
            i = n if nl < 0 else nl
            continue
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            args.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    if "".join(cur).strip():
        args.append("".join(cur).strip())
    return args


PG_CALL = re.compile(r"(?i)\b(?:select|return\s+next|perform)\s+(?:\*\s+from\s+)?([a-z_][a-z0-9_]*)\s*\(")
PG_ASSERT = re.compile(
    r"^(?:ok|is|isnt|i?matches|doesnt_i?match|i?alike|uni?alike|cmp_ok|pass|fail|isa_ok|throws_\w+|lives_ok"
    r"|performs_\w+|results_\w+|set_(?:eq|ne|has|hasnt)|bag_(?:eq|ne|has|hasnt)|is_empty|isnt_empty|row_eq"
    r"|has_\w+|hasnt_\w+|col_\w+|fk_ok|policies_are|policy_\w+|\w+_are|is_\w+|isnt_\w+|function_\w+"
    r"|volatility_is|trigger_is|index_is_\w+|rule_is_\w+)$"
)
SQL_STR = re.compile(r"^'((?:''|[^'])*)'(?:\s*::\s*text)?$", re.S)


def pg_tests(rel: str, text: str) -> list[dict]:
    out = []
    for m in PG_CALL.finditer(text):
        fn = m.group(1).lower()
        if fn in PG_NOT_A_TEST or not PG_ASSERT.match(fn):
            continue
        close = _matching_paren(text, m.end() - 1)
        if close < 0:
            continue
        args = _top_args(text[m.end() : close])
        if not args:
            continue
        last = SQL_STR.match(args[-1])
        name = _clean(last.group(1).replace("''", "'")) if last and len(args) > 1 else ""
        line = text.count("\n", 0, m.start()) + 1
        out.append({"file": rel, "layer": "DB", "name": name, "context": "", "line": line})
    return out


def scan(root: Path) -> list[dict]:
    tests: list[dict] = []
    files = []
    for p in root.rglob("*"):
        if not p.is_file() or any(part in SKIP_DIRS for part in p.relative_to(root).parts):
            continue
        rel = p.relative_to(root).as_posix()
        if rel.startswith("supabase/tests/") and rel.endswith(".test.sql"):
            files.append((rel, p))
        elif JS_TEST_FILE.search(p.name):
            files.append((rel, p))
    for rel, p in sorted(files):
        text = p.read_text(encoding="utf-8", errors="ignore")
        tests.extend(pg_tests(rel, text) if rel.endswith(".sql") else js_tests(rel, text))
    for t in tests:
        both = f"{t['context']} {t['name']}"
        t["cases"] = sorted({f"{a}-{b}" for a, b in CASE_RE.findall(both)})
        t["reqs"] = sorted(set(REQ_ONLY_RE.findall(both)) | {c.rsplit("-", 1)[0] for c in t["cases"]}, key=_nat)
        t["stories"] = sorted(set(STORY_RE.findall(both)), key=_nat)
        t["items"] = sorted(set(ITEM_RE.findall(both)), key=_nat)
        t["area"] = AREAS[t["reqs"][0].split("-")[0]] if t["reqs"] else "Not named"
    return tests


def _nat(s: str):
    return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", s)]


def parse_cases(wps_text: str) -> "OrderedDict[str, dict]":
    """Test cases: rows of a table in an item's §5 section whose first cell is a case ID."""
    cases: "OrderedDict[str, dict]" = OrderedDict()
    item = None
    for line in wps_text.splitlines():
        m = WP_HEAD.match(line)
        if m:
            item = m.group(1)
            continue
        if line.startswith("## ") or (line.startswith("### ") and not m):
            item = None
        if item and line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cells and CASE_FULL.match(cells[0]):
                cases[cells[0]] = {
                    "item": item,
                    "text": cells[1] if len(cells) > 1 else "",
                    "layers": cells[2] if len(cells) > 2 else "",
                }
    return cases


def done_when_items(wps_text: str) -> dict[str, str]:
    """Each item's Done when line."""
    out: dict[str, str] = {}
    item = None
    for line in wps_text.splitlines():
        m = WP_HEAD.match(line)
        if m:
            item = m.group(1)
            continue
        if line.startswith("### ") or line.startswith("## "):
            item = None
        if item and "**Done when:**" in line:
            out[item] = line.split("**Done when:**", 1)[1].strip()
    return out


class Catalogue:
    """Every test, traced to the requirements, stories, items and cases it names."""

    def __init__(self, root: Path, register, stories, wps, wps_text: str, status: dict[str, str], built_stories):
        self.tests = scan(root)
        self.register, self.stories, self.wps = register, stories, wps
        self.status = status
        self.cases = parse_cases(wps_text)
        self.done_when = done_when_items(wps_text)
        self.done = {w for w, s in status.items() if s.startswith("Done")}
        self.built_stories = set(built_stories)
        self.built_reqs = {r for w in self.done if w in wps for r in wps[w]["reqs"]}
        self.by_req = defaultdict(list)
        self.by_story = defaultdict(list)
        self.by_item = defaultdict(list)
        self.by_case = defaultdict(list)
        for t in self.tests:
            for r in t["reqs"]:
                self.by_req[r].append(t)
            for s in t["stories"]:
                self.by_story[s].append(t)
            for w in t["items"]:
                self.by_item[w].append(t)
            for c in t["cases"]:
                self.by_case[c].append(t)
        self.story_reqs = {s: v["reqs"] for s, v in stories.items()}

    # ------------------------------------------------------------------ checks
    def unknown(self) -> list[str]:
        out = []
        known_items = set(self.wps) | set(self.status)
        for t in self.tests:
            where = f"{t['file']}:{t['line']} '{t['name'][:70]}'"
            for r in t["reqs"]:
                if r not in self.register:
                    out.append(f"{where} names unknown requirement {r}")
            for s in t["stories"]:
                if s not in self.stories:
                    out.append(f"{where} names unknown story {s}")
            for w in t["items"]:
                if w.startswith("WP-") and w not in known_items:
                    out.append(f"{where} names unknown backlog item {w}")
            for c in t["cases"]:
                if c not in self.cases:
                    out.append(f"{where} names test case {c}, which no item's §5 table in 05 defines")
        for cid, c in self.cases.items():
            if cid.rsplit("-", 1)[0] not in self.register:
                out.append(f"05 {c['item']}: test case {cid} is for unknown requirement {cid.rsplit('-', 1)[0]}")
            elif cid.rsplit("-", 1)[0] not in self.wps.get(c["item"], {}).get("reqs", []):
                out.append(f"05 {c['item']}: test case {cid} is for a requirement not on the item's Reqs line")
        return out

    def gaps(self) -> list[str]:
        """Gap keys: built requirements and stories with no test, Done items with no test cases,
        and a Done item's cases with no test."""
        g = []
        for r in self.register:
            if r in self.built_reqs and not self.by_req.get(r):
                g.append(f"requirement {r}")
        for s in self.stories:
            if s in self.built_stories and not self.by_story.get(s):
                g.append(f"story {s}")
        for w in self.wps:
            if w in self.done and w in self.done_when and not any(c["item"] == w for c in self.cases.values()):
                g.append(f"done-when {w}")
        for cid, c in self.cases.items():
            if c["item"] in self.done and not self.by_case.get(cid):
                g.append(f"case {cid}")
        return g

    def only_e2e(self) -> list[str]:
        out = []
        for r, meta in self.register.items():
            ts = self.by_req.get(r, [])
            if meta["pri"] == "M" and ts and all(t["layer"] == "E2E" for t in ts):
                out.append(r)
        return out

    # ------------------------------------------------------------ 04 columns
    def layer_counts(self, tests) -> Counter:
        return Counter(t["layer"] for t in tests)

    def counts_cell(self, tests) -> str:
        c = self.layer_counts(tests)
        if not tests:
            return "—"
        return " · ".join(f"{LAYER_SHORT[l]} {c[l]}" for l in LAYERS if c[l])

    def tests_cell(self, rid: str) -> str:
        return self.counts_cell(self.by_req.get(rid, []))

    def coverage_line(self, known: list[str]) -> str:
        named = sum(1 for t in self.tests if t["reqs"])
        built = [r for r in self.register if r in self.built_reqs]
        tested = sum(1 for r in built if self.by_req.get(r))
        return (
            f"- Tests: **{len(self.tests)}** ({named} name a requirement) · built requirements with a test: "
            f"**{tested} of {len(built)}** · known test gaps: **{len(known)}** (`08` §9.6)."
        )

    # ----------------------------------------------------------- catalogue
    def markdown(self, known: list[str]) -> list[str]:
        L: list[str] = []
        req_status = {}
        for r in self.register:
            if r not in self.built_reqs:
                req_status[r] = "Not built"
            elif self.by_req.get(r):
                req_status[r] = "Covered"
            else:
                req_status[r] = "Gap"
        story_status = {}
        for s in self.stories:
            if s not in self.built_stories:
                story_status[s] = "Not built"
            elif self.by_story.get(s):
                story_status[s] = "Covered"
            else:
                story_status[s] = "Gap"
        lc = self.layer_counts(self.tests)
        gaps = self.gaps()
        kinds = Counter(g.split(" ", 1)[0] for g in gaps)
        unnamed = sum(1 for t in self.tests if not (t["reqs"] or t["stories"] or t["items"]))

        L += ["### 9.1 Coverage summary", ""]
        L += [
            f"**{len(self.tests)}** tests: " + " · ".join(f"{l} {lc[l]}" for l in LAYERS)
            + f". {len(self.tests) - unnamed} name at least one ID; {unnamed} name none.",
            "",
            "| Measure | Count |",
            "|---|---|",
            f"| Requirements built (a Done item builds them) | {sum(1 for r in self.register if r in self.built_reqs)} of {len(self.register)} |",
            f"| Built requirements with no test | {sum(1 for v in req_status.values() if v == 'Gap')} |",
            f"| Stories built | {len(self.built_stories)} of {len(self.stories)} |",
            f"| Built stories with no test naming them | {sum(1 for v in story_status.values() if v == 'Gap')} |",
            f"| Done items whose Done when has no test cases | {kinds.get('done-when', 0)} |",
            f"| Test cases | {len(self.cases)} (with a test: {sum(1 for c in self.cases if self.by_case.get(c))}) |",
            f"| Done items' test cases with no test | {kinds.get('case', 0)} |",
            f"| Must requirements covered only by e2e | {len(self.only_e2e())} |",
            f"| Tests naming an unknown ID | {len(self.unknown())} |",
            f"| Known gaps (`known-test-gaps.txt`) | {len(known)} |",
            "",
        ]
        oe = self.only_e2e()
        L += [
            "Must requirements covered only by e2e: " + (", ".join(oe) if oe else "none") + ".",
            "",
        ]

        L += ["### 9.2 Tests by layer and area", ""]
        L += [
            "Area is the domain of the first requirement a test names. "
            + "Layers: Unit (Vitest, node:test), DB (pgTAP), UI (the UI suite), E2E (on the preview).",
            "",
            "| Area | " + " | ".join(LAYERS) + " | Total |",
            "|---|" + "---|" * (len(LAYERS) + 1),
        ]
        by_area = defaultdict(Counter)
        for t in self.tests:
            by_area[t["area"]][t["layer"]] += 1
        for area in list(AREAS.values()) + ["Not named"]:
            c = by_area.get(area, Counter())
            L.append(f"| {area} | " + " | ".join(str(c[l]) for l in LAYERS) + f" | {sum(c.values())} |")
        L.append("| **Total** | " + " | ".join(f"**{lc[l]}**" for l in LAYERS) + f" | **{len(self.tests)}** |")
        L.append("")

        L += ["### 9.3 By requirement", ""]
        L += [
            "Status: **Covered** (built, and at least one test names it), **Gap** (built, no test), "
            "**Not built** (no Done item builds it yet). Tests are counted by layer; the tests themselves are in §9.7.",
            "",
            "| Req | Pri | Status | Stories | Backlog items | Test cases | Tests |",
            "|---|---|---|---|---|---|---|",
        ]
        story_of = defaultdict(list)
        for s, rs in self.story_reqs.items():
            for r in rs:
                story_of[r].append(s)
        item_of = defaultdict(list)
        for w, v in self.wps.items():
            for r in v["reqs"]:
                item_of[r].append(w)
        cases_of = defaultdict(list)
        for cid in self.cases:
            cases_of[cid.rsplit("-", 1)[0]].append(cid)
        for r, meta in self.register.items():
            L.append(
                f"| {r} | {meta['pri']} | {req_status[r]} | {', '.join(sorted(story_of[r], key=_nat)) or '—'} | "
                f"{', '.join(sorted(item_of[r], key=_nat)) or '—'} | {', '.join(cases_of[r]) or '—'} | "
                f"{self.tests_cell(r)} |"
            )
        L.append("")

        L += ["### 9.4 By backlog item", ""]
        L += [
            "Each item's Done when, as test cases (§5 of `05`), and the tests that name the item. "
            "**No cases** on a Done item is a known gap until its cases are written.",
            "",
            "| Item | Status | Test cases | With a test | Tests naming the item |",
            "|---|---|---|---|---|",
        ]
        for w in sorted(self.wps, key=_nat):
            cs = [c for c, v in self.cases.items() if v["item"] == w]
            st = self.status.get(w, "—").split(" ")[0]
            proved = sum(1 for c in cs if self.by_case.get(c))
            no_cases = "**No cases**" if (w in self.done and w in self.done_when) else "—"
            L.append(
                f"| {w} | {st} | {', '.join(cs) if cs else no_cases} | "
                f"{f'{proved} of {len(cs)}' if cs else '—'} | {self.counts_cell(self.by_item.get(w, []))} |"
            )
        L.append("")
        if self.cases:
            L += ["Test cases and the tests that prove them:", "", "| Case | Item | Case | Layer | Tests |", "|---|---|---|---|---|"]
            for cid, c in self.cases.items():
                ts = self.by_case.get(cid, [])
                names = "<br>".join(f"{t['layer']} `{_code(t['file'])}`: {_code_name(t)}" for t in ts) or "**none**"
                L.append(f"| {cid} | {c['item']} | {c['text']} | {c['layers']} | {names} |")
            L.append("")

        L += ["### 9.5 By user story", ""]
        L += [
            "Status as in §9.3, for tests that name the story itself.",
            "",
            "| Story | Reqs | Status | Tests |",
            "|---|---|---|---|",
        ]
        for s in self.stories:
            L.append(
                f"| {s} | {', '.join(self.story_reqs[s])} | {story_status[s]} | {self.counts_cell(self.by_story.get(s, []))} |"
            )
        L.append("")

        L += ["### 9.6 Known gaps", ""]
        L += [
            f"Gaps that existed when the catalogue was first made. CI fails a change that adds a gap not on this list; "
            f"closing one takes it off (`check_traceability.py --fix`). Closing them all is WP-86. **{len(known)}** known gaps: "
            + ", ".join(f"{k} {n}" for k, n in sorted(Counter(x.split(' ', 1)[0] for x in known).items()))
            + ".",
            "",
        ]
        groups = OrderedDict((("requirement", []), ("story", []), ("done-when", []), ("case", [])))
        for k in known:
            kind, ident = k.split(" ", 1)
            groups.setdefault(kind, []).append(ident)
        label = {
            "requirement": "Built requirements with no test",
            "story": "Built stories with no test naming them",
            "done-when": "Done items with no test cases",
            "case": "Test cases with no test",
        }
        L += ["| Kind | Count | IDs |", "|---|---|---|"]
        for kind, ids in groups.items():
            if ids:
                L.append(f"| {label.get(kind, kind)} | {len(ids)} | {', '.join(sorted(ids, key=_nat))} |")
        L.append("")

        L += ["### 9.7 Every test", ""]
        L += [
            "Each test once, by file, with the IDs it names (in its name or its `describe` block). "
            "The file's layer is in its heading.",
            "",
        ]
        by_file = OrderedDict()
        for t in self.tests:
            by_file.setdefault(t["file"], []).append(t)
        for f, ts in by_file.items():
            L += [f"#### `{f}`", "", f"{ts[0]['layer']} · {len(ts)} tests", "", "| Test | Names |", "|---|---|"]
            for t in ts:
                ids = t["cases"] + [r for r in t["reqs"] if not any(c.startswith(r + "-") for c in t["cases"])] + t["stories"] + t["items"]
                L.append(f"| {_code_name(t)} | {', '.join(ids) or '—'} |")
            L.append("")
        return L


def _code(s: str) -> str:
    return s.replace("`", "'").replace("|", "\\|")


def _code_name(t: dict) -> str:
    name = t["name"] or "(no description)"
    if t["context"]:
        name = f"{t['context']} › {name}"
    name = re.sub(r"\s+", " ", name)
    if len(name) > 160:
        name = name[:159].rstrip() + "…"
    return f"`{_code(name)}`"
