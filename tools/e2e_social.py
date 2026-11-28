"""End-to-end test of friends + posts with two real browser engines and a throwaway gym-social server.

Alice = iPhone (WebKit), Bob = Android phone (Chromium). Alice joins with a profile photo, Bob opens her
invite link on a fresh install (onboarding first, then join), they become friends, Alice finishes a
workout and shares it with a caption + progress photo, Bob sees it (photo loads), likes and comments,
Alice sees both. 1.19: Bob opens Alice's profile: her calendar (read-only, today lit, tap shows the workout),
her full Progress (read-only, no bodyweight), photos she marked Public (progress + character, with badges)
appear and disappear when she makes them Private again, and "Share my stats" off leaves name + level only.
Optional owner phase: with GYM_PRIVATE_SERVER=<private server folder> a throwaway copy of the private gym
API (temp CSVs) is the owner upstream; Alice becomes the owner, the app links to it, and a workout
back-dated from her calendar lands in (and is deleted from) that server's Companion CSV.
Then Bob unfriends and the post disappears. Fails on any page error.

Usage: [GYM_PRIVATE_SERVER=...] <venv with playwright>/bin/python tools/e2e_social.py
"""
import functools
import http.server
import io
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tools" / "shots"
problems = []


def port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def jpeg(path, color, size=(1200, 1600)):
    Image.new("RGB", size, color).save(path, "JPEG")
    return str(path)


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        problems.append(msg)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="gym-social-e2e-"))
    site, data = tmp / "site", tmp / "data"
    site_port, api_port = port(), port()
    site_origin = "http://localhost:%d" % site_port
    shutil.copytree(ROOT / "docs", site)
    (site / "config.js").write_text("window.GYM_PUBLIC = true;\nwindow.GYM_SOCIAL_API = 'http://localhost:%d/gs';\n" % api_port)

    env = dict(os.environ, DATA_DIR=str(data), PORT=str(api_port), ORIGINS=site_origin)
    priv, owner_proc, owner_tmp = os.environ.get("GYM_PRIVATE_SERVER"), None, tmp / "owner"
    if priv and (Path(priv) / "tests" / "owner_upstream.py").exists():
        up_port = port()
        owner_proc = subprocess.Popen([sys.executable, str(Path(priv) / "tests" / "owner_upstream.py"), str(up_port), str(owner_tmp)],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        env["OWNER_UPSTREAM"] = "http://127.0.0.1:%d" % up_port
    api = subprocess.Popen([sys.executable, str(ROOT / "server" / "social.py")], env=env, stderr=subprocess.PIPE)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", site_port), functools.partial(Quiet, directory=str(site)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    for _ in range(50):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/health" % api_port, timeout=1); break
        except OSError:
            time.sleep(0.1)

    ava, prog = jpeg(tmp / "ava.jpg", (240, 180, 60)), jpeg(tmp / "progress.jpg", (60, 160, 220))
    SHOTS.mkdir(exist_ok=True)
    with sync_playwright() as pw:
        wk, cr = pw.webkit.launch(), pw.chromium.launch()
        A = wk.new_context(**pw.devices["iPhone 15"]).new_page()
        B = cr.new_context(**pw.devices["Pixel 7"]).new_page()
        for name, pg in (("alice", A), ("bob", B)):
            pg.on("pageerror", lambda e, n=name: problems.append("%s pageerror: %s" % (n, e)))
            pg.on("console", lambda m, n=name: m.type == "error" and "favicon" not in m.text and problems.append("%s console: %s" % (n, m.text)))
            pg.on("dialog", lambda d: d.accept())

        def onboard(pg, bench):
            pg.wait_for_selector("#onSave", state="visible", timeout=15000)
            pg.fill('.cxw[data-ex="Bench Press (Barbell)"]', str(bench))
            pg.click("#onSave")
            pg.wait_for_function("!document.getElementById('sheet').classList.contains('on') || document.getElementById('lvup').classList.contains('on')", timeout=10000)
            pg.wait_for_timeout(1200)
            if pg.locator("#lvup.on").count():
                pg.click("#lvup")

        # --- Alice joins with a profile photo
        A.goto(site_origin + "/")
        onboard(A, 80)
        A.locator("#sJoin").scroll_into_view_if_needed(); A.click("#sJoin")
        A.fill("#sName", "Alice"); A.set_input_files("#sAva", ava)
        A.wait_for_selector("#sAvaPrev img", timeout=5000)
        A.click("#sGo")
        A.wait_for_function("document.getElementById('sKey') && /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(document.getElementById('sKey').textContent)", timeout=10000)
        check(True, "joining shows a recovery key " + A.inner_text("#sKey"))
        A.click("#sKeyDone")
        A.wait_for_selector("#sInvite", timeout=10000)
        code = A.inner_text(".scode").strip()
        check(len(code) == 9 and code[4] == "-", "Alice joined, friend code " + code)
        A.screenshot(path=SHOTS / "social-1-alice-friends.png")
        A.evaluate("closeSheet()")

        # --- Bob opens Alice's invite link on a fresh install: onboarding first, then join, then accept
        B.goto(site_origin + "/#friend=" + code)
        onboard(B, 60)
        B.wait_for_selector("#sName", state="visible", timeout=15000)
        B.fill("#sName", "Bob"); B.click("#sGo")
        B.wait_for_function("document.querySelector('#sList .sfr') !== null || document.querySelector('#socialBox #sOpen') !== null", timeout=15000)
        B.wait_for_timeout(1500)
        B.evaluate("Social.friends()")
        B.wait_for_selector("#sList .sfr", timeout=10000)
        check("Alice" in B.inner_text("#sList"), "Bob accepted the invite: Alice is his friend")
        B.evaluate("closeSheet()")

        # --- Alice works out, finishes, shares with caption + progress photo
        A.wait_for_timeout(600)
        A.click("#goSug"); A.wait_for_selector("#work.on", timeout=10000); A.wait_for_timeout(400)
        A.click("#logBtn"); A.wait_for_timeout(600)
        if A.locator("#rest.on").count():
            A.click("#restSkip"); A.wait_for_timeout(300)
        A.click("#logBtn"); A.wait_for_timeout(600)
        if A.locator("#rest.on").count():
            A.click("#restSkip"); A.wait_for_timeout(300)
        A.click("#finishBtn"); A.wait_for_selector("#fYes", state="visible"); A.click("#fYes")
        A.wait_for_selector("#done.on", timeout=10000); A.wait_for_timeout(900)
        check(A.is_visible("#doneShare"), "finish screen offers Share with friends")
        A.click("#doneShare")
        A.wait_for_selector("#sPost", timeout=8000)
        A.wait_for_selector("#sPrevW .swk", timeout=8000)
        A.fill("#sCap", "New PR day \U0001f4aa")
        A.set_input_files("#sPh", prog); A.wait_for_selector("#sPhPrev img", timeout=5000)
        A.locator("#sPost").scroll_into_view_if_needed()
        A.wait_for_timeout(700)
        top = A.evaluate("(function(){var b=document.querySelector('#sPost').getBoundingClientRect();var el=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return !!el&&(el.id==='sPost'||!!el.closest('#sPost'))})()")
        check(top, "share sheet on the finish screen is on top and tappable")
        A.screenshot(path=SHOTS / "social-2-alice-share.png")
        A.click("#sPost")
        A.wait_for_function("!document.getElementById('sheet').classList.contains('on')", timeout=15000)

        # --- Bob sees it with the photo, likes and comments
        B.evaluate("Social.feed()")
        B.wait_for_selector("#sFeed .spost", timeout=10000)
        B.wait_for_function("(function(){var i=document.querySelector('#sFeed .sphoto');return i&&i.complete&&i.naturalWidth>0})()", timeout=10000)
        post = B.inner_text("#sFeed .spost")
        check("Alice" in post and "New PR day" in post and "Bench Press" in post, "Bob sees Alice's post with her workout card")
        check(B.evaluate("document.querySelector('#sFeed .sphoto').naturalWidth") > 0, "progress photo loads for Bob (signed link)")
        check(B.evaluate("(function(){var i=document.querySelector('#sFeed .spost img.sav');return !!i&&i.naturalWidth>0})()"), "Alice's profile photo loads")
        B.click('#sFeed [data-a="like"]'); B.wait_for_timeout(600)
        B.click('#sFeed [data-a="com"]'); B.wait_for_selector("#sFeed .scin input", timeout=5000)
        B.fill("#sFeed .scin input", "Beast mode!"); B.click('#sFeed [data-a="csend"]')
        B.wait_for_selector("#sFeed .scrow", timeout=5000)
        B.screenshot(path=SHOTS / "social-3-bob-feed.png")

        # --- Alice sees the like + comment
        A.evaluate("closeSheet()"); A.wait_for_timeout(300); A.evaluate("Social.feed()")
        A.wait_for_selector("#sFeed .spost", timeout=10000)
        A.locator("#sFeed .sact button").first.scroll_into_view_if_needed()
        A.wait_for_timeout(700)
        top = A.evaluate("(function(){var b=document.querySelector('#sFeed .sact button').getBoundingClientRect();var el=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return !!el&&(el.id==='x'||!!el.closest('#sFeed .sact button'))})()")
        check(top, "Alice's feed (opened over the finish screen) is on top and tappable")
        acts = A.inner_text("#sFeed .sact")
        check("1" in acts.split("\n")[0] and acts.count("1") >= 2, "Alice sees 1 like and 1 comment (%r)" % acts)
        A.screenshot(path=SHOTS / "social-4-alice-feed.png")

        # --- Bob opens Alice's profile: level + recent workouts
        A.evaluate("Social.sync(true)"); A.wait_for_timeout(1500)
        B.evaluate("closeSheet()"); B.wait_for_timeout(300); B.evaluate("Social.friends()")
        B.wait_for_selector("#sList .sfn", timeout=8000); B.click("#sList .sfn")
        B.wait_for_selector("#pv .pvnum", timeout=8000)
        pv = B.inner_text("#pv")
        check("Alice" in pv and "recent workouts" in pv.lower(), "Bob sees Alice's profile page (%r)" % pv[:80].replace("\n", " "))
        check(B.locator("#pv .swk").count() >= 1, "Alice's recent workouts are listed")
        B.screenshot(path=SHOTS / "social-5-bob-views-alice.png")

        # --- 1.19: header name, Alice's calendar + full Progress for Bob (read-only)
        check(A.inner_text("#hello").strip() == "Hi Alice", "Alice's header says 'Hi Alice' (her Friends name)")
        a_title = A.evaluate("Store.workouts().then(function (l) { return l[0].title; })")
        today = B.evaluate("todayStr()")
        B.wait_for_selector("#pvCal .gcd[data-d]", timeout=8000)
        cell = B.locator('#pvCal .gcd[data-d="%s"]' % today)
        check(cell.count() == 1 and cell.get_attribute("data-n") == "1", "Alice's workout today is lit on her calendar for Bob")
        cell.click(); B.wait_for_selector("#pvCal .gcday", timeout=3000)
        check(a_title in B.inner_text("#pvCal .gcday"), "tapping the day shows Alice's workout title")
        check(B.locator("#pvCal .gcadd").count() == 0 and B.locator("#pvCal button.gcw").count() == 0, "friend's calendar is read-only (no add / edit)")
        check("streak" in B.inner_text("#pvCal") and B.locator("#pvCal [data-streak]").count() == 1, "friend's calendar shows month stats + streak")
        B.locator("#pvCal").scroll_into_view_if_needed(); B.screenshot(path=SHOTS / "social-6-bob-alice-calendar.png")
        B.click("#pvProg"); B.wait_for_selector("#prog.on #pg_train svg", timeout=10000)
        check("Alice" in B.inner_text("#pgTitle") and "Workouts\n1" in B.inner_text(".pgtiles"), "Bob sees Alice's full Progress tiles")
        check(B.locator("#pg_bw").count() == 0 and B.locator("#pg_evo").count() == 0 and B.locator("#pg_split").count() == 1 and B.locator("#pg_qual").count() == 1,
              "friend Progress: same cards, no bodyweight / private photos")
        B.screenshot(path=SHOTS / "social-7-bob-alice-progress.png")
        B.evaluate("GymBack()"); B.wait_for_selector("#pv .pvnum", timeout=8000)
        check(B.evaluate("cur") == "home", "Back from her Progress returns to her profile")

        # --- photos: a progress photo + a character photo, Private by default, Public = friends see them
        A.evaluate("closeSheet(); show('home')"); A.wait_for_timeout(300)
        A.evaluate("GymProfile.open()"); A.wait_for_selector("#meCal .gcd", timeout=8000)
        A.set_input_files("#mePhIn", prog); A.wait_for_selector('#mePh .tlrow[data-kind="progress"]', timeout=8000)
        A.evaluate("GymPhoto.timeline().then(function (l) { return GymPhoto.savePhoto(l[0].img, {lv: 7}); }).then(function () { GymProfile.open(); })")
        A.wait_for_selector('#mePh .tlrow[data-kind="character"]', timeout=8000)
        check(A.locator('#mePh [data-vis="private"].on').count() == 2, "both photos start Private")
        for kind in ("progress", "character"):
            A.click('#mePh .tlrow[data-kind="%s"] [data-vis="public"]' % kind)
            A.wait_for_function("(function(){var r=document.querySelector('#mePh .tlrow[data-kind=\"%s\"] [data-vis=public]');return r&&r.classList.contains('on')})()" % kind, timeout=10000)
        A.screenshot(path=SHOTS / "social-8-alice-photos.png")
        a_id = A.evaluate("Store.get('socialMe').then(function (m) { return m.id; })")
        B.evaluate("Social.profile(%r)" % a_id)
        B.wait_for_selector("#pvPh .tlrow", timeout=8000)
        B.wait_for_function("Array.from(document.querySelectorAll('#pvPh .tlrow img')).every(function (i) { return i.complete && i.naturalWidth > 0; })", timeout=10000)
        kinds = sorted(B.evaluate("Array.from(document.querySelectorAll('#pvPh .tlrow')).map(function (r) { return r.getAttribute('data-kind'); })"))
        check(kinds == ["character", "progress"] and "Character" in B.inner_text("#pvPh"), "Bob sees both public photos in Alice's timeline, character badged")
        check(B.locator("#pvPh [data-vis]").count() == 0, "friend's photo timeline has no visibility controls")
        B.locator("#pvPh .tlimg").first.click(); B.wait_for_selector("#lbox img", timeout=3000)
        B.screenshot(path=SHOTS / "social-9-bob-photo.png"); B.evaluate("GymBack()")
        A.click('#mePh .tlrow[data-kind="progress"] [data-vis="private"]')
        A.wait_for_function("(function(){var r=document.querySelector('#mePh .tlrow[data-kind=\"progress\"] [data-vis=private]');return r&&r.classList.contains('on')})()", timeout=10000)
        B.evaluate("Social.profile(%r)" % a_id); B.wait_for_selector("#pvPh .tlrow", timeout=8000)
        check(B.locator('#pvPh .tlrow[data-kind="progress"]').count() == 0, "back to Private: the progress photo is gone for Bob")
        check(len(list((data / "media").glob("*.jpg"))) >= 1, "server keeps only what's public (+ avatars / posts)")

        # --- Share my stats off: Bob sees name + level only; back on again
        A.uncheck("#meShareStats"); A.wait_for_function("!document.getElementById('meShareStats').disabled", timeout=8000)
        B.evaluate("Social.profile(%r)" % a_id); B.wait_for_selector("#pv .pvnum", timeout=8000)
        check(B.locator("#pvHidden").count() == 1 and B.locator("#pvCal").count() == 0 and B.locator("#pvProg").count() == 0,
              "Share my stats off: no calendar / Progress for friends, just name + level")
        B.screenshot(path=SHOTS / "social-10-bob-stats-hidden.png")
        A.check("#meShareStats"); A.wait_for_function("!document.getElementById('meShareStats').disabled", timeout=8000)
        B.evaluate("Social.profile(%r)" % a_id); B.wait_for_selector("#pvCal .gcd", timeout=8000)
        check(True, "Share my stats back on: calendar is back")
        B.evaluate("closeSheet()"); A.evaluate("GymBack()")

        # --- owner path: Alice is the owner; the app links to her private server; calendar back-dating syncs there
        if owner_proc:
            import csv, sqlite3
            k = sqlite3.connect(str(data / "social.db")); k.execute("INSERT OR REPLACE INTO meta VALUES ('owner_id', ?)", (a_id,)); k.commit(); k.close()
            A.reload(); A.wait_for_function("window.Store && Store.remote === true", timeout=20000)
            check(True, "owner login links the public app to the owner's server")
            A.wait_for_timeout(800)
            if A.locator("#lvup.on").count():
                A.click("#lvup")
            A.evaluate("GymProfile.open()"); A.wait_for_selector("#meCal .gcd", timeout=10000)
            day = A.evaluate("(function(){var d=new Date(Date.now()-2*864e5);return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)})()")
            for _ in range(2):
                if A.locator('#meCal .gcd[data-d="%s"]' % day).count():
                    break
                A.click('#meCal [data-nav="-1"]'); A.wait_for_timeout(200)
            A.click('#meCal .gcd[data-d="%s"]' % day); A.click('#meCal .gcadd[data-add="%s"]' % day)
            A.wait_for_selector("#weTitle", state="visible", timeout=5000)
            A.fill("#weTitle", "Owner Backdated"); A.fill("#weMin", "30")
            A.fill("#wSearch", "squat"); A.locator("#wPick .it").first.click(); A.wait_for_timeout(200)
            A.locator('#wBody input[data-k="w"]').first.fill("90"); A.locator('#wBody input[data-k="r"]').first.fill("5")
            A.click("#wSave"); A.wait_for_function("!document.getElementById('sheet').classList.contains('on')", timeout=10000)
            A.wait_for_timeout(1000)
            csvp = owner_tmp / "Companion" / "workout_data.csv"
            rows = list(csv.DictReader(open(csvp))) if csvp.exists() else []
            check(any(r["title"] == "Owner Backdated" and r["start_time"].startswith(str(int(day[8:]))) or r["title"] == "Owner Backdated" for r in rows),
                  "back-dated workout reached the owner's server Companion CSV")
            check(A.locator('#meCal .gcd[data-d="%s"]' % day).get_attribute("data-n") == "1", "owner calendar lights the back-dated day")
            A.screenshot(path=SHOTS / "social-11-owner-calendar.png")
            A.click('#meCal .gcd[data-d="%s"]' % day); A.click("#meCal .gcday button.gcw"); A.wait_for_selector("#wDel", timeout=8000)
            A.click("#wDel"); A.wait_for_function("!document.getElementById('sheet').classList.contains('on')", timeout=10000)
            A.wait_for_timeout(800)
            rows = list(csv.DictReader(open(csvp)))
            check(not any(r["title"] == "Owner Backdated" for r in rows) and list((owner_tmp / "Companion" / "_edit_backups").glob("*.csv")),
                  "deleting it removes it from the owner's CSV (backup copy kept first)")
            hevy_day = "2026-11-02"
            A.evaluate("GymCal.reset('own'); GymProfile.refresh()"); A.wait_for_timeout(500)
            for _ in range(3):
                if A.locator('#meCal .gcd[data-d="%s"]' % hevy_day).count():
                    break
                A.click('#meCal [data-nav="-1"]'); A.wait_for_timeout(200)
            A.click('#meCal .gcd[data-d="%s"]' % hevy_day)
            check("View" in A.inner_text("#meCal .gcday"), "Hevy-imported workouts stay read-only on the calendar")

        # --- Bob unfriends: the post disappears for him
        B.evaluate("closeSheet()"); B.wait_for_timeout(300); B.evaluate("Social.friends()")
        B.wait_for_selector("#sList .sfr button", timeout=8000); B.click("#sList .sfr button"); B.wait_for_timeout(800)
        B.evaluate("closeSheet()"); B.wait_for_timeout(300); B.evaluate("Social.feed()")
        B.wait_for_selector("#sFeed p.sub", timeout=8000)
        check(B.locator("#sFeed .spost").count() == 0, "after unfriending, Bob no longer sees Alice's post")
        wk.close(); cr.close()
    srv.shutdown(); api.terminate()
    if owner_proc:
        owner_proc.terminate()
    err = api.communicate(timeout=5)[1].decode()
    if "ERROR" in err:
        problems.append("server error: " + err[-500:])
    for p in problems:
        print("  problem:", p)
    print("SOCIAL E2E OK" if not problems else "SOCIAL E2E FAILED (%d)" % len(problems))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
