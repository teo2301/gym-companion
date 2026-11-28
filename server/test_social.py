"""Tests for social.py: runs a real server on a temp data dir and talks HTTP to it.

Usage: python3 server/test_social.py      (needs Pillow; prints PASS/FAIL lines, exits 1 on failure)
"""
import io
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def call(base, method, path, body=None, token=None, raw=None, origin=None, ip=None):
    data, headers = None, {}
    if raw is not None:
        data, headers["Content-Type"] = raw, "image/jpeg"
    elif body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    if origin:
        headers["Origin"] = origin
    if ip:
        headers["X-Forwarded-For"] = ip
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            ct = r.headers.get("Content-Type", "")
            return r.status, (json.loads(r.read()) if "json" in ct else r.read()), r.headers
    except urllib.error.HTTPError as e:
        b = e.read()
        try:
            b = json.loads(b)
        except ValueError:
            pass
        return e.code, b, e.headers


def jpeg_with_gps(w=3000, h=2000):
    im = Image.new("RGB", (w, h), (200, 60, 60))
    exif = Image.Exif()
    exif[0x010F] = "SecretPhoneMaker"                 # Make
    exif[0x8825] = {1: "N", 2: (51.0, 30.0, 0.0), 3: "W", 4: (0.0, 7.0, 0.0)}   # GPS IFD
    out = io.BytesIO(); im.save(out, "JPEG", exif=exif); return out.getvalue()


def main():
    data = Path(tempfile.mkdtemp(prefix="gym-social-test-"))
    port = free_port()
    import http.server, threading
    class Stub(http.server.BaseHTTPRequestHandler):
        def _r(self):
            n = int(self.headers.get("Content-Length") or 0); body = self.rfile.read(n).decode()
            out = json.dumps({"ok": True, "path": self.path, "method": self.command, "body": body}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out)
        do_GET = do_POST = _r
        def log_message(self, *a): pass
    stub = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Stub); threading.Thread(target=stub.serve_forever, daemon=True).start()
    env = dict(os.environ, DATA_DIR=str(data), PORT=str(port), OWNER_UPSTREAM="http://127.0.0.1:%d" % stub.server_address[1])
    proc = subprocess.Popen([sys.executable, str(HERE / "social.py")], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base = "http://127.0.0.1:%d" % port
    try:
        for _ in range(50):
            try:
                if call(base, "GET", "/health")[0] == 200:
                    break
            except OSError:
                time.sleep(0.1)
        s, a, _ = call(base, "POST", "/api/register", {"name": "  Alice \u0000 "})
        check(s == 200 and a["me"]["name"] == "Alice" and len(a["token"]) > 30, "register A, name cleaned")
        A, a_me = a["token"], a["me"]
        _, b, _ = call(base, "POST", "/api/register", {"name": "Luca"}, ip="10.0.0.2"); B, b_me = b["token"], b["me"]
        _, c, _ = call(base, "POST", "/api/register", {"name": "Stranger"}, ip="10.0.0.3"); C = c["token"]; c_id = c["me"]["id"]
        check(call(base, "GET", "/api/me")[0] == 401, "no token -> 401")
        check(call(base, "GET", "/api/me", token="nope")[0] == 401, "bad token -> 401")
        check(call(base, "GET", "/gs/api/me", token=A)[1]["me"]["id"] == a_me["id"], "/gs prefix accepted")

        s, r, _ = call(base, "PUT", "/api/me/avatar", raw=jpeg_with_gps(), token=A)
        check(s == 200 and r["me"]["avatar"], "avatar upload")
        files = list((data / "media").glob("*.jpg"))
        im = Image.open(files[0])
        check(im.size == (256, 256) and not im.getexif(), "avatar is 256x256 with NO EXIF/GPS")
        check(b"SecretPhoneMaker" not in files[0].read_bytes(), "camera make removed from file bytes")
        s, _, _ = call(base, "PUT", "/api/me/avatar", raw=b"<?php evil ?>", token=A)
        check(s == 400, "non-image upload rejected")
        bomb = io.BytesIO(); Image.new("1", (12000, 12000)).save(bomb, "PNG")
        check(call(base, "PUT", "/api/me/avatar", raw=bomb.getvalue(), token=A)[0] == 400, "decompression bomb rejected")

        s, r, _ = call(base, "POST", "/api/friends", {"code": b_me["code"].lower().replace("-", " ")}, token=A)
        check(s == 200 and r["friend"]["name"] == "Luca", "add friend by code (case/spacing tolerant)")
        check([f["name"] for f in call(base, "GET", "/api/friends", token=B)[1]["friends"]] == ["Alice"], "friendship is mutual")
        check(call(base, "POST", "/api/friends", {"code": a_me["code"]}, token=A)[0] == 400, "can't add yourself")
        check(call(base, "POST", "/api/friends", {"code": "ZZZZ-ZZZZ"}, token=A)[0] == 404, "unknown code -> 404")

        wk = {"title": "Push", "date": "2026-11-27", "minutes": 55, "sets": 18, "volume": 6400, "lv": 26, "tier": "Intermediate",
              "lifts": [{"name": "Bench Press (Barbell)", "w": 80, "r": 8, "sets": 3}], "prs": ["Bench Press 80 kg x 8"], "evil": "<script>"}
        s, r, _ = call(base, "POST", "/api/posts", {"caption": "Leg day was rough\n\n\n\nbut good", "workout": wk}, token=A)
        check(s == 200 and "evil" not in r["post"]["workout"] and r["post"]["caption"] == "Leg day was rough\n\nbut good", "post created, workout whitelisted")
        pid = r["post"]["id"]
        s, r, _ = call(base, "PUT", "/api/posts/%s/photo" % pid, raw=jpeg_with_gps(), token=A)
        check(s == 200 and r["post"]["photo"], "progress photo attached")
        big = max((data / "media").glob("*.jpg"), key=lambda p: p.stat().st_mtime)
        pim = Image.open(big)
        check(max(pim.size) == 1600 and not pim.getexif(), "photo capped to 1600px, no EXIF/GPS")
        check(call(base, "PUT", "/api/posts/%s/photo" % pid, raw=jpeg_with_gps(), token=B)[0] == 403, "friend can't replace my photo")

        feedB = call(base, "GET", "/api/feed", token=B)[1]["posts"]
        check(len(feedB) == 1 and feedB[0]["author"]["name"] == "Alice" and feedB[0]["author"]["avatar"], "friend sees my post + avatar")
        check(call(base, "GET", "/api/feed", token=C)[1]["posts"] == [], "stranger's feed is empty")
        check(call(base, "GET", "/api/posts/%s/comments" % pid, token=C)[0] == 404, "stranger can't read comments")
        check(call(base, "POST", "/api/posts/%s/like" % pid, token=C)[0] == 404, "stranger can't like")

        photo = feedB[0]["photo"]
        s, img, h = call(base, "GET", photo)
        check(s == 200 and h["Content-Type"] == "image/jpeg" and img[:2] == b"\xff\xd8", "signed photo link works")
        check(call(base, "GET", photo.replace("&s=", "&s=0"))[0] == 403, "tampered signature -> 403")
        expired = photo.split("?")[0] + "?e=1000&s=" + photo.split("&s=")[1]
        check(call(base, "GET", expired)[0] == 403, "expired link -> 403")
        check(call(base, "GET", "/media/../social.db?e=9999999999&s=x")[0] in (403, 404), "path traversal refused")

        check(call(base, "POST", "/api/posts/%s/like" % pid, token=B)[1] == {"ok": True, "liked": True, "likes": 1}, "like")
        check(call(base, "POST", "/api/posts/%s/like" % pid, token=B)[1]["liked"] is False, "like toggles off")
        call(base, "POST", "/api/posts/%s/like" % pid, token=B)
        s, cm, _ = call(base, "POST", "/api/posts/%s/comments" % pid, {"text": "Beast 💪"}, token=B)
        check(s == 200 and cm["comment"]["text"] == "Beast 💪", "comment (emoji kept)")
        fa = call(base, "GET", "/api/feed", token=A)[1]["posts"][0]
        check(fa["likes"] == 1 and fa["comments"] == 1, "author sees like + comment counts")
        coms = call(base, "GET", "/api/posts/%s/comments" % pid, token=A)[1]["comments"]
        check(coms[0]["can_delete"] and not coms[0]["mine"], "post owner may delete others' comments on it")
        check(call(base, "DELETE", "/api/comments/%s" % cm["comment"]["id"], token=C)[0] == 404, "stranger can't delete comment")
        check(call(base, "DELETE", "/api/comments/%s" % cm["comment"]["id"], token=A)[0] == 200, "owner deletes comment")
        check(call(base, "DELETE", "/api/posts/%s" % pid, token=B)[0] == 403, "friend can't delete my post")

        prof = {"lv": 26, "tier": "Intermediate", "score": 2.6, "xp": 0.4, "muscles": [{"name": "Chest", "level": "Novice", "score": 1.2, "lift": "Bench"}],
                "stats": {"workouts": 5, "volume": 1234, "streak_weeks": 2, "avg_week": 2.5, "since": "2026-01-01"},
                "workouts": [{"title": "Push", "date": "2026-11-01", "minutes": 50, "sets": 12, "volume": 3000, "lifts": [{"name": "Bench", "w": 80, "r": 5, "sets": 3}]}]}
        check(call(base, "PUT", "/api/me/profile", prof, token=B)[0] == 200, "profile snapshot saved")
        s, r, _ = call(base, "GET", "/api/users/%s" % b_me["id"], token=A)
        check(s == 200 and r["profile"]["lv"] == 26 and r["profile"]["workouts"][0]["title"] == "Push", "friend can view a profile")
        check(call(base, "GET", "/api/users/%s" % b_me["id"], token=C)[0] == 404, "non-friend cannot view a profile")
        # older-app snapshot (no `days`): calendar falls back to its recent workouts
        call(base, "PUT", "/api/me/profile", {"lv": 5, "workouts": [{"title": "Full Body", "date": "2026-11-27", "minutes": 44, "sets": 12, "volume": 4105, "lifts": []}]}, token=B)
        pv0 = call(base, "GET", "/api/users/%s" % b_me["id"], token=A)[1]["profile"]
        check(pv0.get("days") and pv0["days"][0]["d"] == "2026-11-27" and pv0["days"][0]["t"] == "Full Body", "old snapshot still shows its workouts on the calendar")
        call(base, "PUT", "/api/me/profile", {"lv": 9999, "workouts": [{"title": "x" * 500}]}, token=B)
        check(call(base, "GET", "/api/users/%s" % b_me["id"], token=A)[1]["profile"]["lv"] == 50, "profile values are clamped")
        check(call(base, "DELETE", "/api/me/profile", token=B)[0] == 200 and call(base, "GET", "/api/users/%s" % b_me["id"], token=A)[1]["profile"] is None, "profile can be withdrawn")
        # v1.19: full stats snapshot (calendar + Progress), Share-my-stats off, per-photo public/private
        days = [{"d": "2026-%02d-%02d" % (1 + i % 11, 1 + i % 27), "t": "Push", "m": 50, "v": 3000, "s": 12, "token": "LEAK"} for i in range(3500)]
        full = dict(prof, days=days + [{"d": "not-a-date", "t": "x"}], week={"workouts": 2, "streak_weeks": 3, "best_week": 4, "avg_workouts_4w": 2.5,
                    "avg_workouts_12w": None, "avg_sets_4w": 40, "weeks": [{"week": "2026-11-23", "workouts": 2}]},
                    server="https://private.example/api", token="secret-token",
                    progress={"stats": {"workouts": [{"date": "2026-11-01", "title": "Push", "minutes": 50, "sets": 12, "reps": 100, "volume": 3000, "note": "private"}],
                                        "exercises": [{"name": "Bench", "sessions": 3, "best_e1rm": 100, "last_date": "2026-11-01"}],
                                        "prs": [{"date": "2026-11-01", "ex": "Bench", "kind": "e1rm", "w": 90, "r": 3, "e1rm": 99}]},
                              "prog": {"overall": {"lv": 26, "tier": "Intermediate", "score": 2.6},
                                       "weeks": [{"week": "2026-10-26", "lv": 25, "score": 2.5, "sets": {"chest": 12, "<script>": 3}, "groups": {"push": 12, "evil": 9}}],
                                       "muscles": {"chest": {"level": "Novice", "level_index": 1, "score": 1.2, "e1rm": 100, "lift": "Bench"}},
                                       "strongest": "chest", "weakest": "DROP TABLE"},
                              "bodyweight": [{"date": "2026-11-01", "kg": 80}]})
        s, r, _ = call(base, "PUT", "/api/me/profile", full, token=B)
        check(s == 200, "full stats snapshot saved")
        pv = call(base, "GET", "/api/users/%s" % b_me["id"], token=A)[1]["profile"]
        dump = json.dumps(pv)
        check(len(pv["days"]) == 3000 and pv["days"][0] == {"d": "2026-01-01", "t": "Push", "m": 50, "v": 3000, "s": 12}, "calendar days capped at 3000, compact, only whitelisted keys")
        check("LEAK" not in dump and "secret-token" not in dump and "private.example" not in dump and "private" not in dump.replace('"shared"', ''), "nothing outside the whitelist (tokens, server link, notes) survives")
        check("bodyweight" not in pv["progress"] and "<script>" not in dump and "evil" not in dump and pv["progress"]["prog"]["weakest"] is None, "progress: no bodyweight, bad keys dropped")
        check(pv["progress"]["stats"]["exercises"][0]["best_e1rm"] == 100 and pv["progress"]["prog"]["weeks"][0]["groups"]["push"] == 12 and pv["week"]["avg_workouts_12w"] is None, "progress numbers kept for the friend's cards")
        check(call(base, "PUT", "/api/me/profile", {"x": "y" * (1100 * 1024)}, token=B)[0] == 413, "oversized snapshot refused")
        call(base, "PUT", "/api/me/profile", dict(full, shared=False), token=B)
        pv = call(base, "GET", "/api/users/%s" % b_me["id"], token=A)[1]["profile"]
        check(pv == {"lv": 26, "tier": "Intermediate", "score": 2.6, "xp": 0.4, "shared": False}, "Share my stats off: friends get name + level only")
        s, r, _ = call(base, "PUT", "/api/me/photos?kind=progress&date=2026-11-20&lv=12", token=A, raw=jpeg_with_gps())
        check(s == 200 and r["photo"]["kind"] == "progress" and r["photo"]["date"] == "2026-11-20", "make a progress photo public")
        ph1 = r["photo"]
        s, r, _ = call(base, "PUT", "/api/me/photos?kind=character&date=bad&lv=99", token=A, raw=jpeg_with_gps(400, 600))
        ph2 = r["photo"]
        check(s == 200 and ph2["kind"] == "character" and ph2["lv"] == 50 and len(ph2["date"]) == 10, "character photo public, date/level sanitised")
        img = call(base, "GET", ph1["url"].replace("/gs", "", 1))[1]
        im = Image.open(io.BytesIO(img))
        check(max(im.size) <= 1280 and not im.getexif() and b"SecretPhoneMaker" not in img, "public photo is resized and EXIF/GPS stripped")
        r = call(base, "GET", "/api/users/%s" % a_me["id"], token=B)[1]
        check([p["id"] for p in r["photos"]] == [ph2["id"], ph1["id"]] or len(r["photos"]) == 2, "friend sees the public photos")
        check(call(base, "GET", "/api/users/%s" % a_me["id"], token=C)[0] == 404, "non-friend can't see photos")
        check(call(base, "DELETE", "/api/me/photos/%s" % ph1["id"], token=B)[1].get("deleted") is False, "can't delete someone else's photo")
        check(call(base, "DELETE", "/api/me/photos/%s" % ph1["id"], token=A)[1].get("deleted") is True and
              [p["id"] for p in call(base, "GET", "/api/users/%s" % a_me["id"], token=B)[1]["photos"]] == [ph2["id"]], "back to private: deleted from the server")
        call(base, "PUT", "/api/me/photos?kind=progress&date=2026-11-21", token=A, raw=jpeg_with_gps(300, 300))
        s, r, _ = call(base, "POST", "/api/me/photos/keep", {"ids": [ph2["id"]]}, token=A)
        check(s == 200 and r["removed"] == 1 and [p["id"] for p in call(base, "GET", "/api/me/photos", token=A)[1]["photos"]] == [ph2["id"]], "keep-list drops public copies the phone no longer has")
        check(call(base, "PUT", "/api/owner/sessions", {"sessions": []}, token=B)[0] == 403, "non-owner cannot sync workouts")
        import sqlite3
        k = sqlite3.connect(str(data / "social.db")); k.execute("INSERT OR REPLACE INTO meta VALUES ('owner_id', ?)", (b_me["id"],)); k.commit(); k.close()
        check(call(base, "GET", "/api/me", token=B)[1].get("owner") is True and "owner" not in call(base, "GET", "/api/me", token=A)[1], "/api/me flags only the owner")
        check(call(base, "PUT", "/api/owner/sessions", {"sessions": [{"id": "x1", "start": 1, "exercises": {}}, "junk"]}, token=B)[1].get("count") == 1, "owner uploads sessions")
        check(call(base, "GET", "/api/owner/sessions", token=B)[1]["sessions"][0]["id"] == "x1" and call(base, "GET", "/api/owner/sessions", token=A)[0] == 403, "only the owner reads them back")
        call(base, "PUT", "/api/owner/sessions", {"sessions": [], "deleted": [1763000000000, "x", True, -5]}, token=B)
        check(json.loads((data / "owner_sessions.json").read_text())["deleted"] == [1763000000000], "owner sync carries deletions (start ms only)")
        s, r, _ = call(base, "GET", "/api/owner/srv/live?v=3&wait=0", token=B)
        check(s == 200 and r["path"] == "/api/gym/live?v=3&wait=0", "owner proxy forwards GET to the private server")
        s, r, _ = call(base, "POST", "/api/owner/srv/op", {"ops": [{"id": "1"}]}, token=B)
        check(s == 200 and r["method"] == "POST" and '"ops"' in r["body"], "owner proxy forwards POST bodies")
        check(call(base, "GET", "/api/owner/srv/plan", token=A)[0] == 403 and call(base, "GET", "/api/owner/srv/plan")[0] == 401, "proxy refuses non-owners and anonymous")
        check(call(base, "GET", "/api/owner/srv/restore", token=B)[0] == 404, "proxy only forwards whitelisted calls")
        s, r, _ = call(base, "POST", "/api/me/recovery", token=C); key = r["key"]
        check(s == 200 and len(key.replace("-", "")) == 20, "recovery key issued")
        s, r, _ = call(base, "POST", "/api/recover", {"key": key.lower()})
        check(s == 200 and call(base, "GET", "/api/me", token=r["token"])[0] == 200, "recovery key signs a new device in as the same account")
        check(call(base, "GET", "/api/me", token=C)[0] == 401, "the old login stops working after recovery")
        C = r["token"]
        check(call(base, "POST", "/api/recover", {"key": "AAAAA-AAAAA-AAAAA-AAAAA"})[0] == 404 and call(base, "POST", "/api/recover", {"key": ""})[0] == 404, "wrong recovery key refused")
        # --- admin.py (owner-only, run on the server): list + reissue a login
        adm = lambda *a: subprocess.run([sys.executable, str(HERE / "admin.py")] + list(a), env=env, capture_output=True, text=True, timeout=30)
        out = adm("list")
        hashes = [r[0] for r in sqlite3.connect(str(data / "social.db")).execute("SELECT token_hash FROM users")]
        check(out.returncode == 0 and "Alice" in out.stdout and a_me["id"] in out.stdout and not any(h in out.stdout for h in hashes),
              "admin list: users with id/name, no token hashes")
        alice_line = [l for l in out.stdout.splitlines() if a_me["id"] in l][0]
        check(alice_line.split()[-1] == "1", "admin list: friend count counts each friendship once")
        posts_before = len(call(base, "GET", "/api/feed", token=B)[1]["posts"])
        out = adm("reissue", "alice")
        link = [l for l in out.stdout.splitlines() if "#social-login=" in l]
        newA = link[0].split("#social-login=")[1] if link else ""
        check(out.returncode == 0 and link and link[0].startswith("https://teo2301.github.io/gym-companion/#social-login=") and len(newA) >= 40,
              "admin reissue by name prints a login link in the app's format")
        check(call(base, "GET", "/api/me", token=A)[0] == 401, "admin reissue: the old login dies")
        check(call(base, "GET", "/api/me", token=newA)[1]["me"]["id"] == a_me["id"] and
              [f["name"] for f in call(base, "GET", "/api/friends", token=newA)[1]["friends"]] == ["Luca"] and
              len(call(base, "GET", "/api/feed", token=B)[1]["posts"]) == posts_before >= 1, "admin reissue keeps friends + posts")
        A = newA
        out = adm("reissue", c_id)
        cnew = [l for l in out.stdout.splitlines() if "#social-login=" in l][0].split("#social-login=")[1]
        check(out.returncode == 0 and call(base, "GET", "/api/me", token=cnew)[1]["me"]["id"] == c_id, "admin reissue by id")
        s, r, _ = call(base, "POST", "/api/recover", {"key": key})
        check(s == 200, "admin reissue leaves the recovery key working")
        C = r["token"]
        check(adm("reissue", "Nobody Here").returncode == 1 and "no user" in adm("reissue", "Nobody Here").stderr, "admin reissue: unknown user errors")
        aud = sqlite3.connect(str(data / "social.db")).execute("SELECT action, user_id, user_name, by FROM admin_audit ORDER BY at").fetchall()
        check([(x[0], x[1]) for x in aud] == [("reissue", a_me["id"]), ("reissue", c_id)] and all(x[3] for x in aud), "admin reissues are audited (who, when)")
        check("token" not in " ".join(str(x) for x in aud).lower() and not any(len(str(v)) == 64 for x in aud for v in x), "audit log holds no secrets")
        old = b_me["code"]
        new = call(base, "POST", "/api/me/code", token=B)[1]["me"]["code"]
        check(new != old and call(base, "POST", "/api/friends", {"code": old}, token=C)[0] == 404, "reset code: old code dead")
        check(call(base, "DELETE", "/api/friends/%s" % a_me["id"], token=B)[0] == 200 and
              call(base, "GET", "/api/feed", token=B)[1]["posts"] == [], "unfriend: posts disappear both ways")

        s, h1, hdr = call(base, "GET", "/api/me", token=A, origin="https://teo2301.github.io")
        check(hdr.get("Access-Control-Allow-Origin") == "https://teo2301.github.io", "CORS allows the web app")
        s, h2, hdr = call(base, "GET", "/api/me", token=A, origin="https://evil.example")
        check(hdr.get("Access-Control-Allow-Origin") is None, "CORS refuses other sites")

        before = len(list((data / "media").glob("*.jpg")))
        check(before >= 2 and call(base, "DELETE", "/api/me", token=A)[0] == 200, "delete account")
        check(len(list((data / "media").glob("*.jpg"))) == 0 and call(base, "GET", "/api/me", token=A)[0] == 401,
              "account delete removed every photo + the login")

        codes = [call(base, "POST", "/api/register", {"name": "x"}, ip="10.9.9.9")[0] for _ in range(7)]
        check(codes.count(429) >= 1, "register is rate limited per IP")
        check(call(base, "POST", "/api/posts", {"caption": "x" * 20000}, token=B)[0] == 413, "oversized JSON -> 413")
    finally:
        proc.terminate()
        err = proc.communicate(timeout=5)[1].decode()
        if "Traceback" in err or "ERROR" in err:
            print(err[-2000:]); fails.append("server logged an error")
    print("SOCIAL TESTS OK" if not fails else "SOCIAL TESTS FAILED (%d)" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
