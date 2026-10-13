#!/usr/bin/env python3
"""[NFR-02][WP-14] Measure the board in the kiosk's own Chromium (SPIKE-03), over its debugging port.

fw-check starts Chromium with the port open to this Pi only, then runs this. It reads how fast the
board became usable from the browser's warm cache, how smooth it is idle and while the home screen
scrolls, and how fast a tap is answered (Calendar, then Home: nothing in the family's data changes).
Budgets come from NFR-02: usable within 2 s from cache, a tap answered within 100 ms.
"""

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
import urllib.request

try:
    import websocket  # python3-websocket, installed by setup.sh
except ImportError:  # pragma: no cover
    print("Missing python3-websocket: run setup.sh again.")
    sys.exit(1)

BUDGET_READY_MS = 2000
BUDGET_TAP_MS = 100
BUDGET_SMOOTH_MEDIAN_MS = 20  # 50 frames a second or better
BUDGET_SMOOTH_P95_MS = 50


class Page:
    """The board's tab, reached through the browser's own debugging connection (answered by the
    browser process even while a page is busy loading), attached to the tab by session."""

    def __init__(self, port):
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=5) as r:
            url = json.load(r)["webSocketDebuggerUrl"]
        self.ws = websocket.create_connection(url, suppress_origin=True, timeout=20)
        self.next_id = 0
        self.session = None

    def close(self):
        try:
            self.ws.close()
        except Exception:  # noqa: BLE001 - closing a dead connection
            pass

    def call(self, method, session=None, timeout=20, **params):
        self.next_id += 1
        msg_id = self.next_id
        msg = {"id": msg_id, "method": method, "params": params}
        if session:
            msg["sessionId"] = session
        self.ws.settimeout(timeout)
        self.ws.send(json.dumps(msg))
        while True:
            got = json.loads(self.ws.recv())
            if got.get("id") == msg_id:
                if "error" in got:
                    raise RuntimeError(f"{method}: {got['error'].get('message')}")
                return got.get("result", {})

    def notify(self, method, session=None, **params):
        """Sends without waiting for the answer (one a busy tab may never give)."""
        self.next_id += 1
        msg = {"id": self.next_id, "method": method, "params": params}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))

    def answers(self, session, timeout=10):
        """Whether the tab behind this session runs a line of script within `timeout` seconds."""
        try:
            self.call("Runtime.evaluate", session=session, timeout=timeout, expression="1")
            return True
        except (websocket.WebSocketTimeoutException, RuntimeError):
            return False

    def board_tabs(self):
        return [
            t
            for t in self.call("Target.getTargets")["targetInfos"]
            if t.get("type") == "page" and "/board" in t.get("url", "")
        ]

    def attach(self):
        """Attaches to the board's tab (once), brings it to the front and checks it answers; False if
        it doesn't yet."""
        tabs = self.board_tabs()
        if not tabs:
            return False
        if self.session is None:
            target = tabs[0]["targetId"]
            self.call("Target.activateTarget", targetId=target)
            self.session = self.call("Target.attachToTarget", targetId=target, flatten=True)[
                "sessionId"
            ]
            self.notify("Runtime.runIfWaitingForDebugger", session=self.session)
        return self.answers(self.session)

    def send(self, method, **params):
        return self.call(method, session=self.session, **params)

    def js(self, expression, wait=True):
        res = self.send(
            "Runtime.evaluate", expression=expression, awaitPromise=wait, returnByValue=True
        )
        if "exceptionDetails" in res:
            raise RuntimeError(res["exceptionDetails"].get("text", "script error"))
        return res.get("result", {}).get("value")

    def click(self, x, y):
        for kind in ("mousePressed", "mouseReleased"):
            self.send("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)

    def wheel(self, x, y, dy):
        self.send("Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y, deltaX=0, deltaY=dy)


def wait_for(fn, timeout, step=0.05):
    end = time.time() + timeout
    while time.time() < end:
        value = fn()
        if value:
            return value
        time.sleep(step)
    return None


def started_after(path, after_ms):
    try:
        with open(path) as f:
            value = int(f.read().strip())
    except (OSError, ValueError):
        return None
    return value if value >= after_ms else None


def board_target(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2) as r:
            targets = json.load(r)
    except OSError:
        return None
    for t in targets:
        if t.get("type") == "page" and "/board" in t.get("url", ""):
            return t
    return None


# Frame times (ms between frames) over `ms`, kept in window.__fwFrames until read.
SAMPLE_FRAMES = """
(ms => new Promise(done => {
  const out = []; let last = performance.now(); const end = last + ms;
  const tick = now => { out.push(now - last); last = now;
    if (now < end) requestAnimationFrame(tick); else { window.__fwFrames = out; done(out); } };
  requestAnimationFrame(tick);
}))(%d)
"""

# Where a rail button is, by its label (Home, Calendar, ...), and whether it shows as chosen.
FIND_BUTTON = """
(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === %s);
  if (!b) return null; const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, pressed: b.getAttribute('aria-pressed') }; })()
"""

WATCH_EVENTS = """
(() => { window.__fwEvents = [];
  new PerformanceObserver(list => { for (const e of list.getEntries())
    window.__fwEvents.push({ name: e.name, duration: e.duration, id: e.interactionId || 0 }); })
  .observe({ type: 'event', durationThreshold: 16 });
  window.__fwLong = [];
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__fwLong.push(e.duration); })
  .observe({ type: 'longtask' });
  return true; })()
"""

SCROLLED = "[...document.querySelectorAll('*')].reduce((s, e) => s + e.scrollTop, 0)"

# The middle of the part of the screen with the most to scroll (the home screen is one screen whose
# lists and cards scroll inside themselves, D-74), or null.
SCROLLER = """
(() => { let best = null, most = 0;
  for (const e of document.querySelectorAll('*')) {
    const extra = e.scrollHeight - e.clientHeight;
    if (extra > most && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.clientHeight > 100) {
      best = e; most = extra; } }
  if (!best) return null; const r = best.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: best.className.split(' ')[0] }; })()
"""


def frames_summary(frames):
    frames = sorted(frames[1:]) or [0]
    median = statistics.median(frames)
    p95 = frames[min(len(frames) - 1, int(len(frames) * 0.95))]
    return median, p95, max(frames), len(frames)


def verdict(ok):
    return "ok" if ok else "OVER BUDGET"


def tap(page, label):
    """Click a rail button; the time until it shows as chosen, and the browser's own input-to-paint."""
    spot = page.js(FIND_BUTTON % json.dumps(label))
    if not spot:
        return None
    page.js("window.__fwEvents = []")
    t0 = time.time()
    page.click(spot["x"], spot["y"])
    pressed = wait_for(
        lambda: (page.js(FIND_BUTTON % json.dumps(label)) or {}).get("pressed") == "true", 5, 0.01
    )
    shown_ms = (time.time() - t0) * 1000 if pressed else None
    time.sleep(1.0)
    events = page.js("window.__fwEvents") or []
    paint_ms = max((e["duration"] for e in events if e["id"]), default=None)
    return shown_ms, paint_ms


def diagnose(page):
    """Why the board's tab didn't answer: what Chromium says of it, whether a new blank tab answers
    (if it does, the board's own page is busy or held; if not, Chromium's debugging is), and how
    busy each Chromium process is."""
    try:
        for t in page.board_tabs():
            print(f"              Tab: {t.get('url', '?')[:80]}, attached {t.get('attached')}, title {t.get('title', '')[:40]!r}")
        blank = page.call("Target.createTarget", url="about:blank")["targetId"]
        session = page.call("Target.attachToTarget", targetId=blank, flatten=True)["sessionId"]
        print(f"              A new blank tab answers: {'yes' if page.answers(session) else 'no'}")
        page.call("Target.closeTarget", targetId=blank)
    except (websocket.WebSocketException, RuntimeError, OSError, KeyError) as e:
        print(f"              Chromium stopped answering too: {e}")
    try:
        ps = subprocess.run(
            ["ps", "-u", str(os.getuid()), "-o", "pid=,stat=,pcpu=,rss=,args="],
            capture_output=True, text=True, timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return
    for line in ps.splitlines():
        pid, stat, cpu, rss, args = (line.split(None, 4) + [""] * 5)[:5]
        if "familywise-chromium" not in args:
            continue
        kind = next((a[7:] for a in args.split() if a.startswith("--type=")), "browser")
        print(f"              Process {pid}: {kind}, state {stat}, {cpu}% CPU, {int(rss) // 1024} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--started", required=True, help="file where fw-kiosk writes when it started Chromium")
    ap.add_argument("--after", type=int, default=0, help="only a start at or after this time (ms)")
    args = ap.parse_args()

    started_ms = wait_for(lambda: started_after(args.started, args.after), 60, 0.2)
    target = wait_for(lambda: board_target(args.port), 60, 0.2)
    if not started_ms or not target:
        print("The board did not start with the debugging port within a minute. Is fw-kiosk running?")
        return 1
    # The tab may still be loading (or signing the board in again) on a slow Pi: attach, and
    # again, until it answers, for up to a minute and a half.
    page = Page(args.port)
    answered = False
    for _ in range(9):
        try:
            if page.attach():
                answered = True
                break
        except (websocket.WebSocketException, RuntimeError, OSError):
            page.close()
            time.sleep(2)
            page = Page(args.port)
        time.sleep(8)
    if not answered:
        print("Board:        the board's tab didn't answer on the debugging port within 90 s; the rest stands.")
        diagnose(page)
        return 1
    try:
        return measure(page, started_ms)
    except websocket.WebSocketTimeoutException:
        print("Board:        the board's tab stopped answering part-way; the rest stands.")
        diagnose(page)
        return 1


def measure(page, started_ms):
    page.send("Performance.enable")

    state = wait_for(
        lambda: page.js(
            "document.readyState === 'complete' && (document.querySelector('.fw-today__rail-end') ? 'board'"
            " : document.querySelector('.fw-keypad') ? 'pair' : null)"
        ),
        30,
    )
    nav = page.js(
        "(() => { const n = performance.getEntriesByType('navigation')[0] || {};"
        " const p = performance.getEntriesByName('first-contentful-paint')[0];"
        " return { origin: performance.timeOrigin, interactive: n.domInteractive, load: n.loadEventEnd,"
        " fcp: p ? p.startTime : null, w: innerWidth, h: innerHeight, dpr: devicePixelRatio,"
        " zoom: getComputedStyle(document.documentElement).zoom }; })()"
    )
    launch_ms = nav["origin"] - started_ms
    # Loaded, by the browser's own clock (not when this check got round to looking).
    ready_ms = launch_ms + (nav.get("load") or 0)

    print(f"Page size:    {nav['w']}x{nav['h']} CSS px, device pixel ratio {nav['dpr']}, zoom {nav['zoom']}")
    print(f"Chromium to page start: {launch_ms:.0f} ms")
    fcp = f"{nav['fcp']:.0f} ms" if nav["fcp"] is not None else "n/a"
    print(f"First paint:  {fcp} after page start")
    interactive = nav.get("interactive") or 0
    print(
        f"Interactive:  {interactive:.0f} ms after page start, from the warm cache"
        f"   [budget {BUDGET_READY_MS} ms: {verdict(interactive < BUDGET_READY_MS)}]"
    )
    if not state:
        print("Board:        did not finish loading within 30 s")
        return 1
    print(f"Board ready:  {ready_ms:.0f} ms after Chromium started ({'the family board' if state == 'board' else 'the pairing screen'})")
    if state == "pair":
        print("This board isn't paired yet: pair it (Settings, Boards in the admin app), then run fw-check again.")
        return 0

    time.sleep(2)
    median, p95, worst, n = frames_summary(page.js(SAMPLE_FRAMES % 3000))
    print(
        f"Idle:         {1000 / median:.0f} frames a second (median {median:.1f} ms, p95 {p95:.1f} ms, {n} frames)"
    )

    spot = page.js(SCROLLER)
    if not spot:
        spot = {"x": nav["w"] / 2, "y": nav["h"] / 2, "name": "the page"}
    x, y = spot["x"], spot["y"]
    before = page.js(SCROLLED)
    page.js(SAMPLE_FRAMES % 3000, wait=False)
    end = time.time() + 2.6
    while time.time() < end:
        page.wheel(x, y, 80)
        time.sleep(0.04)
    time.sleep(0.6)
    moved = page.js(SCROLLED) != before
    median, p95, worst, n = frames_summary(page.js("window.__fwFrames") or [0, 0])
    ok = median <= BUDGET_SMOOTH_MEDIAN_MS and p95 <= BUDGET_SMOOTH_P95_MS
    print(
        f"Scrolling:    {1000 / max(median, 0.1):.0f} frames a second (median {median:.1f} ms, p95 {p95:.1f} ms,"
        f" worst {worst:.0f} ms, {spot['name']}){'' if moved else ', but nothing scrolled'}"
        f"   [budget median {BUDGET_SMOOTH_MEDIAN_MS} ms, p95 {BUDGET_SMOOTH_P95_MS} ms: {verdict(ok)}]"
    )
    for _ in range(40):
        page.wheel(x, y, -200)

    page.js(WATCH_EVENTS)
    for label in ("Calendar", "Home"):
        result = tap(page, label)
        if not result:
            print(f"Tap {label}:".ljust(14) + "no such button on this board")
            continue
        shown, paint = result
        shown_s = f"{shown:.0f} ms" if shown is not None else "never"
        paint_s = f"{paint:.0f} ms" if paint is not None else "under 16 ms"
        ok = paint is None or paint < BUDGET_TAP_MS
        print(
            f"Tap {label}:".ljust(14)
            + f"answered in {paint_s} (tap to next frame), chosen after {shown_s}"
            f"   [budget {BUDGET_TAP_MS} ms: {verdict(ok)}]"
        )
    longs = page.js("window.__fwLong") or []
    print(f"Long tasks:   {len(longs)} over 50 ms during the taps, longest {max(longs, default=0):.0f} ms")

    metrics = {m["name"]: m["value"] for m in page.send("Performance.getMetrics")["metrics"]}
    print(
        f"Page memory:  {metrics.get('JSHeapUsedSize', 0) / 1e6:.0f} MB in use,"
        f" {metrics.get('Nodes', 0):.0f} elements"
    )
    print("Celebrations: watch one on the screen; this check doesn't start one.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
