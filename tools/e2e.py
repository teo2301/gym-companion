"""End-to-end check of the public web app in real browser engines (Playwright).

Serves docs/ on localhost and, per engine (WebKit as iPhone Safari, Chromium as Android Chrome):
onboarding -> level shown -> start workout -> log a set -> finish -> data survives a reload ->
backup export contains the workout -> app loads OFFLINE from the service worker. Fails on any
page error. Screenshots go to tools/shots/.

Usage: <venv with playwright>/bin/python tools/e2e.py
"""
import datetime as dt
import functools
import shutil
import tempfile
import http.server
import json
import sys
import traceback
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOCS, SHOTS = ROOT / "docs", ROOT / "tools" / "shots"


SITE = Path(tempfile.mkdtemp(prefix="gym-e2e-"))
BODY_JPG = SITE.parent / "gym-e2e-body.jpg"


def body_photo():
    """A plain full-body silhouette on a light background, used as the photo character."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (600, 900), (225, 228, 232)); d = ImageDraw.Draw(im)
    skin, shirt, legs = (205, 150, 120), (40, 90, 160), (40, 40, 50)
    d.ellipse((250, 60, 350, 170), fill=skin); d.rectangle((285, 165, 315, 195), fill=skin)
    d.rounded_rectangle((205, 190, 395, 480), 40, fill=shirt)
    d.rounded_rectangle((150, 200, 200, 470), 25, fill=skin); d.rounded_rectangle((400, 200, 450, 470), 25, fill=skin)
    d.rounded_rectangle((215, 470, 295, 850), 30, fill=legs); d.rounded_rectangle((305, 470, 385, 850), 30, fill=legs)
    im.save(BODY_JPG, "JPEG", quality=90)   # a copy of docs/, so the update test can change it


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
    page.on("console", lambda m: m.type == "error" and not m.text.startswith("INFO:") and problems.append(f"console: {m.text}"))   # MediaPipe logs INFO via console.error
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

    # Progress & charts: opens offline, counts the workout, logs bodyweight, exercise detail, table view, Back
    page.locator("#openProg").scroll_into_view_if_needed(); page.click("#openProg")
    page.wait_for_selector("#pg_train svg", timeout=10000)
    tiles = page.inner_text(".pgtiles")
    if "Workouts\n1" not in tiles:
        problems.append("progress tiles don't count the workout: %r" % tiles[:80])
    if tiles.count("first 3M") != 6 or "vs the previous 3M" not in page.inner_text("#pgCmpNote"):
        problems.append("tiles should say 'first 3M' with no earlier workouts: %r" % tiles)
    page.click('#pgRange [data-r="all"]'); page.wait_for_timeout(300)
    if "prev" in page.inner_text(".pgtiles") or "first" in page.inner_text(".pgtiles") or page.locator("#pgCmpNote").count():
        problems.append("All period must not compare with a previous period")
    page.click('#pgRange [data-r="3m"]'); page.wait_for_timeout(300)
    page.fill("#pgBwIn", "81.5"); page.click("#pgBwGo"); page.wait_for_timeout(800)
    if "81.5" not in page.inner_text("#pgn_bw"):
        problems.append("bodyweight log not shown")
    page.click('[data-tab="train"]'); page.wait_for_selector("#pg_train table", timeout=3000); page.click('[data-tab="train"]')
    page.locator("#pg_ex .pgrow").first.scroll_into_view_if_needed(); page.locator("#pg_ex .pgrow").first.click()
    page.wait_for_selector("#exReps table", timeout=8000)
    page.screenshot(path=SHOTS / f"{tag}-4c-exercise.png")
    page.evaluate("closeSheet()"); page.wait_for_timeout(300)
    page.evaluate("document.getElementById('pg_train').scrollIntoView({block:'center'})"); page.wait_for_timeout(200)
    page.screenshot(path=SHOTS / f"{tag}-4d-progress.png")
    if not page.evaluate("GymBack()") or page.evaluate("cur") != "home":
        problems.append("Back from Progress did not return home")
    page.wait_for_timeout(600)

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

    # ---- Cardio: quick start, timer, sprint + jog intervals, persistence, finish + benefits, backup/CSV, editor
    page.goto(url); page.wait_for_function("window.Store && window.plan", timeout=15000); page.wait_for_timeout(800)
    page.locator("#openCardio").scroll_into_view_if_needed(); page.click("#openCardio")
    page.wait_for_selector("#cdPick .it", timeout=5000); page.locator("#cdPick .it").first.click()
    page.wait_for_selector("#cardioPanel #cdGo", state="visible", timeout=10000)
    page.click("#cdGo"); page.wait_for_timeout(2300); page.click("#cdGo"); page.wait_for_timeout(500)
    clock = page.inner_text("#cdClock")
    if clock in ("0:00", "0:01"):
        problems.append(f"cardio timer did not run ({clock})")
    page.click('#cdMode [data-m="sprint"]'); page.fill("#cdKmh", "15"); page.fill("#cdKm", "0.5")
    page.click("#logBtn"); page.wait_for_selector("#exSets .cdset", timeout=5000)
    page.click('#cdMode [data-m="jog"]'); page.fill("#cdMin", "10"); page.fill("#cdKmh", "8"); page.fill("#cdKcal", "99")
    page.click("#logBtn"); page.wait_for_function("document.querySelectorAll('#exSets .cdset').length === 2", timeout=5000)
    page.screenshot(path=SHOTS / f"{tag}-7-cardio.png")
    page.reload(); page.wait_for_selector("#cardioPanel", state="visible", timeout=15000); page.wait_for_timeout(600)
    if page.locator("#exSets .cdset").count() != 2:
        problems.append("cardio intervals not kept after reload")
    page.click("#finishBtn"); page.wait_for_selector("#fYes", state="visible", timeout=5000); page.click("#fYes")
    page.wait_for_selector("#done.on", timeout=10000); page.wait_for_selector("#sBenefits .hb", timeout=5000)
    ben = page.inner_text("#sBenefits")
    if "Cardiorespiratory" not in ben or "Sprints" not in ben or "not medical advice" not in ben:
        problems.append("benefits card incomplete: %r" % ben[:120])
    page.locator("#sBenefits").scroll_into_view_if_needed(); page.screenshot(path=SHOTS / f"{tag}-8-benefits.png")
    page.click("#homeBtn"); page.wait_for_timeout(1500)
    sess = page.evaluate("Store.backupData().then(function (d) { return d.sessions; })")
    cs = [d for s in sess for e in (s.get("exercises") or []) if isinstance(e, dict) for d in (e.get("done") or []) if d.get("mode")]
    if sorted(d["mode"] for d in cs) != ["jog", "sprint"] or not any(d["km"] == 0.5 and d["kmh"] == 15 for d in cs) or not any(d["kcal"] == 99 and d["sec"] == 600 for d in cs):
        problems.append("backup lacks cardio fields: %r" % cs)
    csv = page.evaluate("Store.backupData().then(function (d) { return GymCore.csv(d.sessions); })")
    if ",0.5," not in csv or ",600," not in csv or "mode=sprint" not in csv or "kcal=99" not in csv:
        problems.append("CSV lacks cardio distance/duration/notes")
    wk = page.evaluate("Store.workouts().then(function (l) { return Store.workout(l[0].id); })")
    page.evaluate("workoutEditor(%r)" % wk["id"]); page.wait_for_selector("#wSave", timeout=5000)
    if "sprint" not in page.eval_on_selector_all("#wBody select[data-k=mode]", "els => els.map(e => e.value)") or not page.locator("#wBenefits .hb").count():
        problems.append("workout editor doesn't show cardio intervals / benefits")
    page.click("#wSave"); page.wait_for_function("!document.getElementById('sheet').classList.contains('on')", timeout=5000)
    wk2 = page.evaluate("Store.workout(%r)" % wk["id"])
    if sum(1 for e in wk2["exercises"] for x in e["sets"] if x.get("type") == "cardio") != 2:
        problems.append("saving the edited workout dropped cardio intervals")

    # ---- Editor: add a cardio machine to a past workout, fill minutes + distance, the rest is worked out
    page.evaluate("workoutEditor(%r)" % wk["id"]); page.wait_for_selector("#wSave", timeout=5000)
    page.fill("#wSearch", "rowing machine"); page.wait_for_selector("#wPick .it", timeout=5000); page.click("#wPick .it")
    n_ex = page.evaluate("document.querySelectorAll('#wBody .wex').length")
    page.fill("#wBody .wex:last-child input[data-k=min]", "20")
    page.fill("#wBody .wex:last-child input[data-k=km]", "3")
    page.select_option("#wBody .wex:last-child select[data-k=mode]", "jog")
    page.click("#wBody .wex:last-child [data-a=aset]")          # + Add interval, left empty -> must be refused
    if page.locator("#wBody .wex:last-child select[data-k=mode]").count() != 2:
        problems.append("editor: + Add interval didn't add a cardio interval")
    page.click("#wSave"); page.wait_for_timeout(400)
    if not page.evaluate("document.getElementById('sheet').classList.contains('on')"):
        problems.append("editor saved an empty cardio interval")
    page.click("#wBody .wex:last-child .wset:nth-last-of-type(2) [data-a=dset]")
    page.locator("#wBody .wex:last-child").screenshot(path=SHOTS / f"{tag}-8c-editor-cardio.png")
    page.click("#wSave"); page.wait_for_function("!document.getElementById('sheet').classList.contains('on')", timeout=5000)
    wk3 = page.evaluate("Store.workout(%r)" % wk["id"])
    tm = [x for e in wk3["exercises"] if e["name"] == "Rowing Machine" for x in e["sets"]]
    if len(tm) != 1 or tm[0].get("type") != "cardio" or tm[0].get("sec") != 1200 or tm[0].get("km") != 3 \
            or tm[0].get("kmh") != 9 or not tm[0].get("kcal") or tm[0].get("mode") != "jog":
        problems.append(f"editor cardio interval saved wrong: {tm}")
    if len(wk3["exercises"]) != n_ex:
        problems.append("editor lost or duplicated exercises when adding cardio")
    page.evaluate("workoutEditor(%r)" % wk["id"]); page.wait_for_selector("#wSave", timeout=5000)
    page.fill("#wBody .wex:last-child input[data-k=min]", "25"); page.fill("#wBody .wex:last-child input[data-k=kcal]", "")
    page.click("#wSave"); page.wait_for_function("!document.getElementById('sheet').classList.contains('on')", timeout=5000)
    tm2 = [x for e in page.evaluate("Store.workout(%r)" % wk["id"])["exercises"] if e["name"] == "Rowing Machine" for x in e["sets"]]
    if not tm2 or tm2[0].get("sec") != 1500:
        problems.append(f"editing a cardio interval's minutes didn't save: {tm2}")

    # ---- Photo character: a framed full-body picture (no background removal), shown on home, in backups; crafted backups can't inject
    page.click("#settingsBtn"); page.wait_for_selector("#charNew", timeout=5000); page.click("#charNew")
    page.wait_for_selector("#phFile", state="attached", timeout=5000)
    page.set_input_files("#phFile", str(BODY_JPG))
    page.wait_for_function("!document.getElementById('phSave').disabled", timeout=10000)
    page.click("#phSave")
    page.wait_for_function("!document.getElementById('sheet').classList.contains('on')", timeout=90000)
    page.wait_for_selector("#lifterFig .char-photo img", timeout=10000)
    page.wait_for_timeout(600); page.locator("#lifterFig").screenshot(path=SHOTS / f"{tag}-9a-photo-card.png")
    ph = page.evaluate("GymPhoto.data()")
    if not ph["photos"] or not ph["photos"][0]["img"].startswith("data:image/jpeg;base64,") or ph["mode"] != "photo":
        problems.append("photo character not saved")
    if not page.evaluate("Store.backupData && Backup ? true : false"):
        problems.append("backup module missing")
    page.evaluate("""GymPhoto.saveData({mode: 'photo', photos: [{id: 'evil', img: 'x" onerror="window.__pwned=1', date: '2026-01-01', lv: 3}]})
      .then(function () { renderLifter(); })""")
    page.wait_for_timeout(800)
    if page.evaluate("window.__pwned") or page.evaluate("GymPhoto.data().then(function (d) { return d.photos.length; })") != 0:
        problems.append("crafted photo data was not rejected")
    page.screenshot(path=SHOTS / f"{tag}-9-photo.png")

    # ---- Compare with the previous period: 40 days later, the 1M tiles show the drop as text (arrow + %)
    page.evaluate("closeSheet && closeSheet()"); page.wait_for_timeout(300)
    page.clock.set_system_time(dt.datetime.now() + dt.timedelta(days=40))
    page.locator("#openProg").scroll_into_view_if_needed(); page.click("#openProg")
    page.wait_for_selector("#pg_train svg", timeout=10000)
    page.click('#pgRange [data-r="1m"]'); page.wait_for_timeout(400)
    tiles = page.inner_text(".pgtiles")
    if tiles.count("▼ 100%") < 3 or "Workouts\n0\n" not in tiles:
        problems.append("1M tiles 40 days later should read '▼ 100%%': %r" % tiles)
    page.screenshot(path=SHOTS / f"{tag}-10-prev-period.png")
    page.click('#pgRange [data-r="3m"]'); page.wait_for_timeout(300)

    # ---- Exercise detail: own period filter (default All), strength-standard lines, projection text.
    # Five rising Bench Press (Barbell) sessions over the last 5 weeks (throwaway browser data only).
    page.evaluate("""Store.backupData().then(function (b) {
      var now = Date.now(), add = [];
      [35, 28, 21, 14, 7].forEach(function (d, i) {
        var st = now - d * 864e5;
        add.push({id: 'e2e-bench-' + i, start: st, end: st + 3600e3, title: 'E2E Push',
          exercises: {'Bench Press (Barbell)': [{weight_kg: 70 + 2.5 * i, reps: 5}, {weight_kg: 70 + 2.5 * i, reps: 5}]}});
      });
      b.sessions = add; return Store.restore(b, 'merge');
    })""")
    page.evaluate("Progress.exercise('Bench Press (Barbell)')")
    page.wait_for_selector("#exChart svg", timeout=8000); page.wait_for_timeout(400)
    if page.locator('#exRange button.on').inner_text() != "All":
        problems.append("exercise detail should open on All")
    refs = page.locator("#exChart text.cref").all_text_contents()
    if not refs or not any("Intermediate" in r or "Novice" in r or "Advanced" in r for r in refs):
        problems.append(f"no strength-standard lines on the 1RM chart: {refs}")
    std = page.inner_text("#exStd")
    if "Strength standards for 81.5 kg bodyweight" not in std or "Elite" not in std:
        problems.append(f"standards text wrong: {std!r}")
    proj = page.inner_text("#exProj")
    if not proj.startswith("At your recent rate") or " by " not in proj:
        problems.append(f"no projection text: {proj!r}")
    page.locator("#sheet").screenshot(path=SHOTS / f"{tag}-11-exercise-detail.png")
    page.evaluate("document.getElementById('exProj').scrollIntoView({block:'end'})"); page.wait_for_timeout(200)
    page.screenshot(path=SHOTS / f"{tag}-11b-exercise-notes.png")
    n_all = page.locator("#exSess .pgrow").count()
    page.click('#exRange [data-r="1m"]'); page.wait_for_timeout(300)
    n_1m = page.locator("#exSess .pgrow").count()
    if not (n_all in (5, 6) and n_1m == 4):
        problems.append(f"exercise period filter: All {n_all} sessions, 1M {n_1m} (want 5-6 / 4)")
    if "in this period" not in page.inner_text("#exNote"):
        problems.append("exercise note should talk about the period")
    page.click("#exTab"); page.wait_for_timeout(200)
    if page.locator("#exChart table tr").count() != n_1m + 1:
        problems.append("exercise chart Table view rows don't match the period")
    page.click("#exTab"); page.click('#exMetric [data-m="volume"]'); page.wait_for_timeout(200)
    if page.inner_text("#exStd") or page.inner_text("#exProj"):
        problems.append("standards/projection should only show on Est. 1RM")
    page.evaluate("closeSheet()"); page.wait_for_timeout(300)
    page.evaluate("GymBack()"); page.wait_for_timeout(300)

    print(f"{engine:9} {device:18} LV {lv} -> offline LV {lv_off}, workouts {len(sessions)}, "
          f"{n_ex} exercises, tone {page.evaluate('Lifter.tone()')}, problems {len(problems)}")
    browser.close()
    return problems


def main() -> int:
    SHOTS.mkdir(exist_ok=True)
    body_photo()
    srv, url = serve()
    failed = []
    with sync_playwright() as pw:
        for engine, device in (("webkit", "iPhone 15"), ("chromium", "Pixel 7")):
            try:
                problems = run(pw, engine, device, url)
            except Exception as e:  # a timeout means a step never happened
                where = next((f"line {fr.lineno}: " for fr in reversed(traceback.extract_tb(e.__traceback__)) if fr.filename == __file__), "")
                problems = [where + f"{type(e).__name__}: " + " | ".join(l.strip() for l in str(e).splitlines()[:12])]
            for p in problems:
                print(f"  {engine}: {p}")
            failed += problems
    srv.shutdown()
    print("E2E OK" if not failed else f"E2E FAILED ({len(failed)})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
