"""End-to-end check of the public web app in real browser engines (Playwright).

Serves docs/ on localhost and, per engine (WebKit as iPhone Safari, Chromium as Android Chrome):
onboarding -> level shown -> start workout -> log a set -> finish -> data survives a reload ->
backup export contains the workout -> app loads OFFLINE from the service worker. Fails on any
page error. Screenshots go to tools/shots/.

Usage: <venv with playwright>/bin/python tools/e2e.py
"""
import functools
import shutil
import tempfile
import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOCS, SHOTS = ROOT / "docs", ROOT / "tools" / "shots"


SITE = Path(tempfile.mkdtemp(prefix="gym-e2e-"))   # a copy of docs/, so the update test can change it


def serve() -> tuple[http.server.ThreadingHTTPServer, str]:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    shutil.copytree(DOCS, SITE, dirs_exist_ok=True)
    handler = functools.partial(Quiet, directory=str(SITE))
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
    page.click('#toneRow [data-tone="brown"]')                      # pick a look during onboarding
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

    # Settings pill: visible, on screen, not overlapping the greeting
    sb, hb, vw = page.locator("#settingsBtn").bounding_box(), page.locator("#hello").bounding_box(), page.viewport_size["width"]
    if not sb or sb["x"] < 0 or sb["x"] + sb["width"] > vw or sb["height"] < 40:
        problems.append(f"settings button off-screen or too small: {sb}")
    elif hb and hb["x"] + hb["width"] > sb["x"]:
        problems.append("settings button overlaps the greeting")
    # Edit routine from the routine list: add a preset by search, save, check it stuck
    page.locator(".redit").first.scroll_into_view_if_needed()
    rname = page.locator(".rrow .rcard b").first.inner_text()
    page.locator(".redit").first.click()
    page.wait_for_selector("#eSearch", state="visible", timeout=5000)
    page.fill("#eSearch", "face pull")
    page.locator("#ePick .it").first.click()
    page.click("#eSave")
    page.wait_for_function("!document.getElementById('sheet').classList.contains('on')", timeout=5000)
    has_fp = page.evaluate("Store.plan().then(function (p) { var r = p.routines.filter(function (x) { return x.name === %r; })[0];"
                           " return !!r && r.exercises.some(function (e) { return e.name === 'Face Pull'; }); })" % rname)
    if not has_fp:
        problems.append(f"editing routine {rname!r} did not save the added exercise")
    page.wait_for_timeout(400)
    page.screenshot(path=SHOTS / f"{tag}-2c-routines.png", full_page=False)
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

    # Edit the finished workout from Recent workouts: change reps, add a set, save
    page.locator("#workouts .wcard").first.scroll_into_view_if_needed()
    page.locator("#workouts .wcard").first.click()
    page.wait_for_selector("#wSave", state="visible", timeout=5000)
    page.locator('#wBody input[data-k="r"]').first.fill("12")
    page.locator('#wBody [data-a="aset"]').first.click()
    page.screenshot(path=SHOTS / f"{tag}-4b-edit-workout.png")
    tap(page, "#wSave")
    page.wait_for_function("!document.getElementById('sheet').classList.contains('on')", timeout=5000)
    wk = page.evaluate("Store.workouts().then(function (l) { return Store.workout(l[0].id); })")
    first = wk["exercises"][0]["sets"]
    if not any(x["r"] == 12 for x in first) or wk["total_sets"] < 2:
        problems.append(f"workout edit did not stick: {wk}")

    # Preset library: the add-exercise picker must offer the common lifts with no custom setup
    n_ex = page.evaluate("Store.plan().then(function (p) { return p.exercises.length; })")
    if n_ex < 150:
        problems.append(f"only {n_ex} exercises offered; preset library missing")
    hip = page.evaluate("Store.plan().then(function (p) { var e = p.exercises.filter(function (x) { return x.name === 'Hip Thrust (Barbell)'; })[0]; return e && e.muscles.primary; })")
    if hip != ["glutes"]:
        problems.append(f"preset muscles wrong for Hip Thrust: {hip}")
    # Skin tone: change it in Settings, it must redraw and survive a reload
    page.click("#settingsBtn")
    page.wait_for_selector('#toneRow [data-tone="deep"]', state="visible", timeout=5000)
    page.click('#toneRow [data-tone="deep"]')
    page.wait_for_timeout(300)
    page.screenshot(path=SHOTS / f"{tag}-2b-settings-tone.png")
    page.evaluate("closeSheet()")

    page.reload()
    page.wait_for_function("window.Store && document.getElementById('lvNum').textContent.trim() !== '–'", timeout=10000)
    page.wait_for_timeout(500)
    if "#5f3b23" not in page.inner_html("#lifterFig"):
        problems.append(f"skin tone not kept after reload (tone={page.evaluate('Lifter.tone()')})")
    data = page.evaluate("Store.backupData()")
    if (data.get("settings") or {}).get("skinTone") != "deep":
        problems.append("skin tone missing from backup")
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
    if "#5f3b23" not in page.inner_html("#lifterFig"):
        problems.append("skin tone lost offline")
    page.screenshot(path=SHOTS / f"{tag}-5-offline.png")
    ctx.set_offline(False)
    if page.evaluate("Store.workouts().then(function (l) { return l.length; })") != 1:
        problems.append("workout missing after offline reload")

    # A new version is published while the app is open: the update pill appears, Update keeps the data
    sw = SITE / "sw-public.js"
    sw.write_text(sw.read_text().replace("var CACHE = 'gym-public-", "var CACHE = 'gym-public-next-"))
    page.reload()
    page.wait_for_selector("#updPill", state="visible", timeout=20000)
    page.screenshot(path=SHOTS / f"{tag}-6-update.png")
    page.click('#updPill [data-a="go"]')
    page.wait_for_function("window.Store && document.getElementById('lvNum').textContent.trim() !== '–'", timeout=10000)
    page.wait_for_timeout(500)
    after = page.evaluate("Store.workouts().then(function (l) { return l.length ? Store.workout(l[0].id) : null; })")
    if not after or not any(x["r"] == 12 for x in after["exercises"][0]["sets"]):
        problems.append("data (or the edit) lost after updating")
    shutil.copy(DOCS / "sw-public.js", sw)   # next engine starts from the real build

    print(f"{engine:9} {device:18} LV {lv} -> offline LV {lv_off}, workouts {len(sessions)}, "
          f"{n_ex} exercises, tone {page.evaluate('Lifter.tone()')}, problems {len(problems)}")
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
