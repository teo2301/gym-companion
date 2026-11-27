"""End-to-end check of the public web app in real browser engines (Playwright).

Serves docs/ on localhost and, per engine (WebKit as iPhone Safari, Chromium as Android Chrome):
onboarding -> level shown -> start workout -> log a set -> finish -> data survives a reload ->
backup export contains the workout -> app loads OFFLINE from the service worker. Fails on any
page error. Screenshots go to tools/shots/.

Usage: <venv with playwright>/bin/python tools/e2e.py
"""
import functools
import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOCS, SHOTS = ROOT / "docs", ROOT / "tools" / "shots"


def serve() -> tuple[http.server.ThreadingHTTPServer, str]:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(DOCS))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://localhost:{srv.server_address[1]}/"


def tap(page, sel: str) -> None:
    """Dismiss the level-up celebration if it is up, then tap [sel] like a finger would."""
    if page.locator("#lvup.on").count():
        page.click("#lvup")
        page.wait_for_function("!document.getElementById('lvup').classList.contains('on')", timeout=5000)
    if page.locator("#rest.on").count() and sel != "#restSkip":
        page.click("#restSkip")
        page.wait_for_function("!document.getElementById('rest').classList.contains('on')", timeout=5000)
    if sel == "#lvup":
        return
    page.locator(sel).scroll_into_view_if_needed()
    page.click(sel)


def run(pw, engine: str, device: str, url: str) -> list[str]:
    problems: list[str] = []
    browser = getattr(pw, engine).launch()
    ctx = browser.new_context(**pw.devices[device], accept_downloads=True, service_workers="allow")
    page = ctx.new_page()
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and problems.append(f"console: {m.text}"))
    tag = engine
    page.goto(url)

    page.wait_for_selector("#onSave", state="visible", timeout=15000)
    page.screenshot(path=SHOTS / f"{tag}-1-onboarding.png")
    page.fill("#onBw", "80")
    page.fill('.cxw[data-ex="Bench Press (Barbell)"]', "80")
    page.fill('.cxw[data-ex="Squat (Barbell)"]', "100")
    page.fill('.cxw[data-ex="Deadlift (Barbell)"]', "120")
    tap(page, "#onSave")
    page.wait_for_function("document.getElementById('lvNum').textContent.trim() !== '–'", timeout=10000)
    lv = page.inner_text("#lvNum")
    page.wait_for_timeout(1500)
    page.screenshot(path=SHOTS / f"{tag}-2-levelup.png")
    tap(page, "#lvup")  # only dismisses the level-up screen, if shown
    page.wait_for_timeout(500)
    page.screenshot(path=SHOTS / f"{tag}-2-home.png")

    tap(page, "#goSug")
    page.wait_for_selector("#work.on", timeout=10000)
    page.wait_for_timeout(500)
    tap(page, "#logBtn")
    page.wait_for_timeout(800)
    page.screenshot(path=SHOTS / f"{tag}-3-workout.png")
    tap(page, "#finishBtn")
    page.wait_for_selector("#fYes", state="visible", timeout=5000)
    tap(page, "#fYes")
    page.wait_for_selector("#done.on", timeout=10000)
    page.wait_for_timeout(800)
    page.screenshot(path=SHOTS / f"{tag}-4-summary.png")
    tap(page, "#homeBtn")
    page.wait_for_timeout(1500)

    page.reload()
    page.wait_for_function("window.Store && document.getElementById('lvNum').textContent.trim() !== '–'", timeout=10000)
    data = page.evaluate("Store.backupData()")
    sessions = data.get("sessions") or []
    if len(sessions) != 1:
        problems.append(f"expected 1 saved workout after reload, found {len(sessions)}")
    if not data.get("seedBests"):
        problems.append("onboarding maxes were not saved")

    # Export through the real UI path (download on desktop engines; share sheet on a real iPhone)
    with page.expect_download(timeout=10000) as dl:
        page.evaluate("Backup.exportJson()")
    exported = json.loads(Path(dl.value.path()).read_text())
    if len(exported.get("sessions") or []) != 1:
        problems.append("exported backup does not contain the workout")

    # Offline: service worker must serve the whole app with the network gone
    page.evaluate("navigator.serviceWorker.ready")
    page.wait_for_timeout(1500)
    ctx.set_offline(True)
    page.reload()
    page.wait_for_function("window.Store && document.getElementById('lvNum').textContent.trim() !== '–'", timeout=10000)
    lv_off = page.inner_text("#lvNum")
    page.screenshot(path=SHOTS / f"{tag}-5-offline.png")
    ctx.set_offline(False)

    print(f"{engine:9} {device:18} LV {lv} -> offline LV {lv_off}, workouts {len(sessions)}, "
          f"backup file {dl.value.suggested_filename}, problems {len(problems)}")
    browser.close()
    return problems


def main() -> int:
    SHOTS.mkdir(exist_ok=True)
    srv, url = serve()
    failed = []
    with sync_playwright() as pw:
        for engine, device in (("webkit", "iPhone 15"), ("chromium", "Pixel 7")):
            try:
                problems = run(pw, engine, device, url)
            except Exception as e:  # a timeout means a step never happened
                problems = [f"{type(e).__name__}: " + " | ".join(l.strip() for l in str(e).splitlines()[:12])]
            for p in problems:
                print(f"  {engine}: {p}")
            failed += problems
    srv.shutdown()
    print("E2E OK" if not failed else f"E2E FAILED ({len(failed)})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
