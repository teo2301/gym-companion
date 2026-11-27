"""Tests for social.py: runs a real server on a temp data dir and talks HTTP to it.

Usage: python3 server/test_social.py      (needs Pillow; prints PASS/FAIL lines, exits 1 on failure)
"""
import io
import json
import os
import socket
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
    env = dict(os.environ, DATA_DIR=str(data), PORT=str(port))
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
        _, c, _ = call(base, "POST", "/api/register", {"name": "Stranger"}, ip="10.0.0.3"); C = c["token"]
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
