#!/usr/bin/env python3
"""Gym Companion social API: profiles, friends, and friends-only workout posts with photos.

Small and self-contained (stdlib + Pillow, SQLite). For friends & family on a home server for now;
the app only talks to this one API, so it can move to a cloud host later by changing the base URL.

Auth: no email/password. POST /api/register returns a secret token the app keeps; every other call
sends it as "Authorization: Bearer <token>". Only a SHA-256 of the token is stored.

Friends: each user has a friend code; adding someone's code makes you friends both ways (sharing
your code is the consent). Unfriend any time; reset your code so an old one can't be reused.

Visibility: a post (and its photo, likes, comments) is visible only to its author and their friends.
Photos/avatars are re-encoded server-side (EXIF/GPS stripped, size capped) and served only through
signed, expiring /media URLs handed out in responses to people allowed to see them.

Endpoints (all JSON unless noted; prefix /gs is accepted and stripped):
  POST   /api/register              {name}                -> {token, me}
  GET    /api/me                                          -> {me}
  POST   /api/me                    {name}                -> {me}
  PUT    /api/me/avatar             raw image body        -> {me}
  POST   /api/me/code                                     -> {me}   (new friend code)
  DELETE /api/me                                          -> {ok}   (account + everything in it)
  GET    /api/friends                                     -> {friends:[...]}
  POST   /api/friends               {code}                -> {friend}
  DELETE /api/friends/<id>                                -> {ok}
  POST   /api/posts                 {caption, workout}    -> {post}
  PUT    /api/posts/<id>/photo      raw image body        -> {post}
  DELETE /api/posts/<id>                                  -> {ok}
  GET    /api/feed?before=<ms>                            -> {posts:[...]}
  PUT    /api/me/profile            snapshot              -> {ok}   (whitelisted; {shared:false} = name + level only)
  GET    /api/users/<id>                                  -> {user, profile, photos}   (friends + self only)
  GET    /api/me/photos                                   -> {photos:[...]}   (my public photos)
  PUT    /api/me/photos?kind=&date=&lv=  raw image body   -> {photo}   (make one photo public: friends-only)
  DELETE /api/me/photos/<id>                              -> {ok}   (back to private: deleted from the server)
  POST   /api/me/photos/keep        {ids:[...]}           -> {ok, removed}   (drop public copies the phone no longer has)
  POST   /api/posts/<id>/like                             -> {liked, likes}   (toggle)
  GET    /api/posts/<id>/comments                         -> {comments:[...]}
  POST   /api/posts/<id>/comments   {text}                -> {comment}
  DELETE /api/comments/<id>                               -> {ok}   (yours, or on your post)
  GET    /media/<file>?e=&s=        signed image (JPEG)
  GET    /health
"""
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import unicodedata
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image, ImageOps

DATA = Path(os.environ.get("DATA_DIR", "/data"))
MEDIA = DATA / "media"
DB_PATH = DATA / "social.db"
PORT = int(os.environ.get("PORT", "8000"))
PREFIX = "/gs"
ORIGINS = set(filter(None, os.environ.get("ORIGINS", ",".join([
    "https://teo2301.github.io",                    # public web app (iPhone etc.)
    "https://appassets.androidplatform.net",        # public Android app (WebViewAssetLoader)
])).split(",")))

MAX_JSON = 16 * 1024
MAX_PROFILE_JSON = 1024 * 1024        # stats snapshot incl. the whole dated workout list (a few hundred KB at most)
MAX_SYNC_JSON = 6 * 1024 * 1024          # owner-only workout sync (whole history, a few hundred KB in practice)
OWNER_UPSTREAM = os.environ.get("OWNER_UPSTREAM", "").rstrip("/")   # the owner's private gym server (proxied for the owner only)
OWNER_SRV = {"plan", "progress", "live", "op", "history", "workouts", "stats", "workout", "note", "routine", "custom", "backup"}
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "")   # shown to the owner only, never baked into the public app
MAX_IMAGE = 8 * 1024 * 1024          # upload cap; the app resizes to ~1600px first, so ~0.3-1 MB
PHOTO_PX, AVATAR_PX = 1600, 256
MEDIA_TTL = 6 * 3600                 # signed media links last 6 h (feeds are refetched often)
MEDIA_CAP = 5 * 1024 ** 3            # refuse new photos past 5 GB total (protects the disk)
MAX_POSTS_PER_USER = 2000
MAX_PHOTOS_PER_USER = 200            # public progress / character photos
PROFILE_PHOTO_PX = 1280
FEED_PAGE = 20
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"    # no 0/O, 1/I/L

Image.MAX_IMAGE_PIXELS = 50_000_000  # refuse decompression bombs

# (requests, seconds) per key
RATES = {"register": (5, 3600), "write": (120, 600), "upload": (40, 3600), "read": (900, 600)}
_hits = defaultdict(deque)
_lock = threading.Lock()
_db_lock = threading.Lock()


# ---------------------------------------------------------------- storage
def db():
    con = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_db():
    DATA.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(exist_ok=True)
    con = db()
    con.execute("PRAGMA journal_mode = WAL")
    con.executescript("""
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL, avatar TEXT, created INTEGER NOT NULL, last_seen INTEGER);
    CREATE TABLE IF NOT EXISTS friends (
      a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created INTEGER NOT NULL, PRIMARY KEY (a, b));
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created INTEGER NOT NULL, caption TEXT NOT NULL DEFAULT '', workout TEXT, photo TEXT);
    CREATE INDEX IF NOT EXISTS posts_by_time ON posts(created);
    CREATE TABLE IF NOT EXISTS likes (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created INTEGER NOT NULL, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, date TEXT NOT NULL, lv INTEGER NOT NULL DEFAULT 0, file TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS photos_by_user ON photos(user_id, date);
    """)
    try:
        con.execute("ALTER TABLE users ADD COLUMN recovery_hash TEXT")   # recovery key (hashed), see /api/recover
    except sqlite3.OperationalError:
        pass
    if not con.execute("SELECT v FROM meta WHERE k='media_key'").fetchone():
        con.execute("INSERT INTO meta VALUES ('media_key', ?)", (secrets.token_hex(32),))
    con.close()


def media_key():
    con = db()
    try:
        return con.execute("SELECT v FROM meta WHERE k='media_key'").fetchone()[0].encode()
    finally:
        con.close()


def now_ms():
    return int(time.time() * 1000)


# ---------------------------------------------------------------- helpers
def clean_text(s, limit, multiline=False):
    s = unicodedata.normalize("NFC", str(s or ""))
    keep = "\n" if multiline else ""
    s = "".join(ch for ch in s if ch in keep or unicodedata.category(ch)[0] != "C")
    s = re.sub(r"\n{3,}", "\n\n", s) if multiline else re.sub(r"\s+", " ", s)
    return s.strip()[:limit]


def new_code(con):
    while True:
        raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        code = raw[:4] + "-" + raw[4:]
        if not con.execute("SELECT 1 FROM users WHERE code=?", (code,)).fetchone():
            return code


def norm_code(code):
    raw = re.sub(r"[^A-Z0-9]", "", str(code or "").upper())
    return raw[:4] + "-" + raw[4:8] if len(raw) == 8 else ""


def sign(name, exp):
    return hmac.new(MEDIA_KEY, ("%s|%d" % (name, exp)).encode(), hashlib.sha256).hexdigest()[:32]


def media_url(name):
    if not name:
        return None
    exp = (int(time.time()) // 3600 + 1) * 3600 + MEDIA_TTL   # rounded, so URLs stay cacheable for an hour
    return "%s/media/%s?e=%d&s=%s" % (PREFIX, name, exp, sign(name, exp))


def media_bytes_used():
    return sum(p.stat().st_size for p in MEDIA.glob("*.jpg"))


def save_image(raw, px, square=False):
    """Decode, fix orientation, strip all metadata, cap the size, re-encode as JPEG. -> filename."""
    try:
        im = Image.open(io.BytesIO(raw))
        if im.format not in ("JPEG", "PNG", "WEBP", "GIF"):
            raise ValueError("unsupported image type")
        im.load()
        im = ImageOps.exif_transpose(im)
    except (OSError, ValueError, Image.DecompressionBombError) as e:
        raise ValueError("not a usable image (%s)" % e.__class__.__name__)
    if im.mode not in ("RGB", "L"):
        bg = Image.new("RGB", im.size, (12, 14, 18))
        im = im.convert("RGBA")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    im = im.convert("RGB")
    if square:
        im = ImageOps.fit(im, (px, px), Image.LANCZOS)
    else:
        im.thumbnail((px, px), Image.LANCZOS)
    name = secrets.token_hex(16) + ".jpg"
    out = io.BytesIO()
    im.save(out, "JPEG", quality=84 if square else 82, optimize=True, progressive=True)   # no exif= -> none written
    (MEDIA / name).write_bytes(out.getvalue())
    return name


def drop_media(name):
    if name and re.fullmatch(r"[0-9a-f]{32}\.jpg", name):
        try:
            (MEDIA / name).unlink()
        except FileNotFoundError:
            pass


def clean_workout(w):
    """Whitelist the workout card the app sends (it's shown to friends, never trusted as data)."""
    if not isinstance(w, dict):
        return None
    num = lambda v, lo, hi: max(lo, min(hi, float(v))) if isinstance(v, (int, float)) else 0
    lifts = []
    for x in (w.get("lifts") or [])[:8]:
        if isinstance(x, dict) and x.get("name"):
            lifts.append({"name": clean_text(x["name"], 60), "w": round(num(x.get("w"), 0, 1000), 2),
                          "r": int(num(x.get("r"), 0, 1000)), "sets": int(num(x.get("sets"), 0, 100))})
    return {"title": clean_text(w.get("title"), 60) or "Workout",
            "date": clean_text(w.get("date"), 10), "minutes": int(num(w.get("minutes"), 0, 1000)),
            "sets": int(num(w.get("sets"), 0, 2000)), "volume": int(num(w.get("volume"), 0, 10_000_000)),
            "lv": int(num(w.get("lv"), 0, 50)), "tier": clean_text(w.get("tier"), 20),
            "lifts": lifts, "prs": [clean_text(p, 80) for p in (w.get("prs") or [])[:8] if p]}


def _num(v, lo, hi, nd=None):
    if not isinstance(v, (int, float)) or isinstance(v, bool) or v != v:
        return 0
    v = max(lo, min(hi, float(v)))
    return int(v) if nd is None else round(v, nd)


def _date(s):
    s = str(s or "")
    return s if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) else ""


def _key(s):
    s = str(s or "")
    return s if re.fullmatch(r"[a-z_]{1,24}", s) else ""


def _opt(v, lo, hi, nd=1):
    return None if v is None else _num(v, lo, hi, nd)


def clean_profile(b):
    """Whitelist the stats snapshot friends can view: level, muscle levels, headline stats, recent workout cards,
    and (v1.19) the dated workout list for the calendar + the numbers behind every Progress card. Everything is
    re-built field by field from known keys with clamped numbers and short cleaned strings; nothing else survives.
    {shared: false} (the "Share my stats" switch is off) keeps only the name (on the account) and the level."""
    b = b if isinstance(b, dict) else {}
    base = {"lv": _num(b.get("lv"), 0, 50), "tier": clean_text(b.get("tier"), 20),
            "score": _num(b.get("score"), -1, 5, 3), "xp": _num(b.get("xp"), 0, 1, 3)}
    if b.get("shared") is False:
        return dict(base, shared=False)
    muscles = []
    for m in (b.get("muscles") or [])[:30]:
        if isinstance(m, dict) and m.get("name"):
            muscles.append({"name": clean_text(m["name"], 30), "level": clean_text(m.get("level"), 20),
                            "score": _num(m.get("score"), -1, 5, 2), "lift": clean_text(m.get("lift"), 60)})
    st = b.get("stats") if isinstance(b.get("stats"), dict) else {}
    workouts = []
    for w in (b.get("workouts") or [])[:20]:
        cw = clean_workout(w)
        if cw:
            cw["lifts"] = cw["lifts"][:6]
            workouts.append(cw)
    days = []                                   # calendar: every workout, compact (date, title, min, kg, sets)
    for d in (b.get("days") or [])[:3000]:
        if isinstance(d, dict) and _date(d.get("d")):
            days.append({"d": _date(d["d"]), "t": clean_text(d.get("t"), 60) or "Workout", "m": _num(d.get("m"), 0, 1000),
                         "v": _num(d.get("v"), 0, 10_000_000), "s": _num(d.get("s"), 0, 2000)})
    wk = b.get("week") if isinstance(b.get("week"), dict) else None
    week = None
    if wk:
        week = {"workouts": _num(wk.get("workouts"), 0, 100), "streak_weeks": _num(wk.get("streak_weeks"), 0, 1000),
                "best_week": _num(wk.get("best_week"), 0, 100), "avg_workouts_4w": _opt(wk.get("avg_workouts_4w"), 0, 50),
                "avg_workouts_12w": _opt(wk.get("avg_workouts_12w"), 0, 50), "avg_sets_4w": _opt(wk.get("avg_sets_4w"), 0, 2000),
                "weeks": [{"week": _date(x.get("week")), "workouts": _num(x.get("workouts"), 0, 100)}
                          for x in (wk.get("weeks") or [])[:60] if isinstance(x, dict)]}
    out = dict(base, shared=True, muscles=muscles, workouts=workouts, days=days, week=week,
               stats={"workouts": _num(st.get("workouts"), 0, 100000), "volume": _num(st.get("volume"), 0, 1e9),
                      "streak_weeks": _num(st.get("streak_weeks"), 0, 1000), "avg_week": _num(st.get("avg_week"), 0, 50, 1),
                      "since": clean_text(st.get("since"), 10)})
    out["progress"] = clean_progress(b.get("progress"))
    return out


def clean_progress(p):
    """The numbers the Progress cards are drawn from (GymCore.stats + GymCore.progress), read-only for friends.
    Bodyweight is deliberately NOT accepted: it isn't shared."""
    if not isinstance(p, dict):
        return None
    st = p.get("stats") if isinstance(p.get("stats"), dict) else {}
    pr = p.get("prog") if isinstance(p.get("prog"), dict) else {}
    wos = [{"date": _date(w.get("date")), "title": clean_text(w.get("title"), 60) or "Workout", "minutes": _num(w.get("minutes"), 0, 1000),
            "sets": _num(w.get("sets"), 0, 2000), "reps": _num(w.get("reps"), 0, 100000), "volume": _num(w.get("volume"), 0, 10_000_000)}
           for w in (st.get("workouts") or [])[-3000:] if isinstance(w, dict) and _date(w.get("date"))]
    exs = []
    for x in (st.get("exercises") or [])[:200]:
        if isinstance(x, dict) and x.get("name"):
            exs.append({"name": clean_text(x["name"], 80), "sessions": _num(x.get("sessions"), 0, 100000),
                        "first_date": _date(x.get("first_date")), "last_date": _date(x.get("last_date")),
                        "best_e1rm": _num(x.get("best_e1rm"), 0, 2000, 1), "best_e1rm_date": _date(x.get("best_e1rm_date")),
                        "heaviest": _num(x.get("heaviest"), 0, 2000, 2), "heaviest_date": _date(x.get("heaviest_date")),
                        "best_volume": _num(x.get("best_volume"), 0, 10_000_000), "total_reps": _num(x.get("total_reps"), 0, 10_000_000),
                        "total_volume": _num(x.get("total_volume"), 0, 1e10)})
    prs = [{"date": _date(x.get("date")), "ex": clean_text(x.get("ex"), 80), "kind": "weight" if x.get("kind") == "weight" else "e1rm",
            "w": _num(x.get("w"), 0, 2000, 2), "r": _num(x.get("r"), 0, 1000), "e1rm": _num(x.get("e1rm"), 0, 2000, 1)}
           for x in (st.get("prs") or [])[-500:] if isinstance(x, dict) and _date(x.get("date")) and x.get("ex")]
    weeks = []
    for w in (pr.get("weeks") or [])[-520:]:
        if not (isinstance(w, dict) and _date(w.get("week"))):
            continue
        sets = {}
        for k, v in list((w.get("sets") or {}).items())[:30] if isinstance(w.get("sets"), dict) else []:
            if _key(k):
                sets[k] = _num(v, 0, 500, 1)
        g = w.get("groups") if isinstance(w.get("groups"), dict) else {}
        weeks.append({"week": _date(w["week"]), "lv": _num(w.get("lv"), 0, 50), "score": _num(w.get("score"), -1, 5, 3), "sets": sets,
                      "groups": {k: _num(g.get(k), 0, 1000, 1) for k in ("push", "pull", "legs", "core")}})
    mus = {}
    for k, x in list((pr.get("muscles") or {}).items())[:30] if isinstance(pr.get("muscles"), dict) else []:
        if _key(k) and isinstance(x, dict):
            mus[k] = {"level": clean_text(x.get("level"), 20), "level_index": _num(x.get("level_index"), -1, 4),
                      "score": _num(x.get("score"), -1, 5, 3), "e1rm": _num(x.get("e1rm"), 0, 2000, 1), "lift": clean_text(x.get("lift"), 80)}
    ov = pr.get("overall") if isinstance(pr.get("overall"), dict) else {}
    return {"stats": {"workouts": wos, "exercises": exs, "prs": prs},
            "prog": {"overall": {"lv": _num(ov.get("lv"), 0, 50), "tier": clean_text(ov.get("tier"), 20), "score": _num(ov.get("score"), -1, 5, 3)},
                     "weeks": weeks, "muscles": mus, "strongest": _key(pr.get("strongest")) or None, "weakest": _key(pr.get("weakest")) or None}}


def photo_json(r):
    return {"id": r["id"], "kind": r["kind"], "date": r["date"], "lv": r["lv"], "url": media_url(r["file"])}


def limited(key, kind):
    n, window = RATES[kind]
    now = time.monotonic()
    with _lock:
        q = _hits[kind + key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= n:
            return True
        q.append(now)
        if len(_hits) > 5000:
            for k in [k for k, v in _hits.items() if not v][:2500]:
                del _hits[k]
        return False


def is_owner(con, uid):
    r = con.execute("SELECT v FROM meta WHERE k='owner_id'").fetchone()
    return bool(r) and r[0] == uid


def are_friends(con, a, b):
    return a == b or bool(con.execute("SELECT 1 FROM friends WHERE a=? AND b=?", (a, b)).fetchone())


def user_json(u, me=False):
    out = {"id": u["id"], "name": u["name"], "avatar": media_url(u["avatar"])}
    if me:
        out["code"] = u["code"]
    return out


def post_json(con, p, viewer):
    likes = con.execute("SELECT COUNT(*) FROM likes WHERE post_id=?", (p["id"],)).fetchone()[0]
    mine = bool(con.execute("SELECT 1 FROM likes WHERE post_id=? AND user_id=?", (p["id"], viewer)).fetchone())
    ncom = con.execute("SELECT COUNT(*) FROM comments WHERE post_id=?", (p["id"],)).fetchone()[0]
    author = con.execute("SELECT * FROM users WHERE id=?", (p["user_id"],)).fetchone()
    return {"id": p["id"], "created": p["created"], "caption": p["caption"],
            "workout": json.loads(p["workout"]) if p["workout"] else None, "photo": media_url(p["photo"]),
            "author": user_json(author), "mine": p["user_id"] == viewer,
            "likes": likes, "liked": mine, "comments": ncom}


# ---------------------------------------------------------------- HTTP
class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


class Handler(BaseHTTPRequestHandler):
    server_version = "gym-social"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def parse_request(self):
        ok = super().parse_request()
        if ok and (self.path == PREFIX or self.path.startswith(PREFIX + "/")):
            self.path = self.path[len(PREFIX):] or "/"
        return ok

    def log_message(self, *a):
        pass

    def _ip(self):
        return (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _send(self, code, obj):
        if code >= 400:
            sys.stderr.write("%s %s %s -> %d %s\n" % (self._ip(), self.command, self.path.split("?")[0], code, obj.get("error", "")))
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ApiError(413, "too large")
        return self.rfile.read(n) if n else b""

    def _proxy(self, method, upstream_path, query):
        """Forward one call to the owner's private gym server (watch live link). Owner-only; the private
        server has no login of its own and is never exposed directly."""
        import urllib.error
        import urllib.request
        body = self._body(MAX_SYNC_JSON) if method == "POST" else None
        req = urllib.request.Request(OWNER_UPSTREAM + upstream_path + ("?" + query if query else ""), data=body, method=method,
                                     headers={"Content-Type": "application/json"} if body is not None else {})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            except ValueError:
                raise ApiError(e.code, "server error")
        except (urllib.error.URLError, TimeoutError, ValueError):
            raise ApiError(502, "your server is unreachable")

    def _json(self, limit=MAX_JSON):
        try:
            v = json.loads(self._body(limit) or b"{}")
            return v if isinstance(v, dict) else {}
        except ValueError:
            raise ApiError(400, "bad JSON")

    def _user(self, con):
        m = re.match(r"Bearer\s+(\S+)", self.headers.get("Authorization", ""))
        if not m:
            raise ApiError(401, "sign in first")
        u = con.execute("SELECT * FROM users WHERE token_hash=?", (hashlib.sha256(m.group(1).encode()).hexdigest(),)).fetchone()
        if not u:
            raise ApiError(401, "unknown account")
        if not u["last_seen"] or now_ms() - u["last_seen"] > 3600_000:
            con.execute("UPDATE users SET last_seen=? WHERE id=?", (now_ms(), u["id"]))
        return u

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        url = urlparse(self.path)
        path, qs = url.path.rstrip("/") or "/", parse_qs(url.query)
        try:
            if method == "GET" and path.startswith("/media/"):
                return self._media(path[7:], qs)
            if method == "GET" and path == "/health":
                return self._send(200, {"ok": True})
            kind = "read" if method == "GET" else ("upload" if method == "PUT" else "write")
            if path in ("/api/register", "/api/recover"):
                kind = "register"
            if limited(self._ip(), kind):
                raise ApiError(429, "slow down")
            ps = re.fullmatch(r"(?:/gs)?/api/owner/srv/([a-z]+)", path)
            if ps:                              # long-polls: authenticate under the lock, forward OUTSIDE it
                with _db_lock:
                    con = db()
                    try:
                        owner_ok = is_owner(con, self._user(con)["id"])
                    finally:
                        con.close()
                if not owner_ok:
                    raise ApiError(403, "owner only")
                if not OWNER_UPSTREAM or ps.group(1) not in OWNER_SRV or method not in ("GET", "POST"):
                    raise ApiError(404, "not found")
                code, obj = self._proxy(method, "/api/gym/" + ps.group(1), url.query)
                return self._send(code, obj)
            with _db_lock:                      # SQLite + tiny traffic: one writer at a time is plenty
                con = db()
                try:
                    con.execute("BEGIN IMMEDIATE")
                    code, obj = self._route(con, method, path, qs)
                    con.execute("COMMIT")
                except BaseException:
                    con.execute("ROLLBACK")
                    raise
                finally:
                    con.close()
            self._send(code, obj)
        except ApiError as e:
            self._send(e.code, {"ok": False, "error": e.msg})
        except Exception as e:  # never leak a traceback to the client
            sys.stderr.write("ERROR %s %s: %r\n" % (method, path, e))
            self._send(500, {"ok": False, "error": "server error"})

    def _media(self, name, qs):
        if not re.fullmatch(r"[0-9a-f]{32}\.jpg", name):
            raise ApiError(404, "not found")
        try:
            exp, sig = int(qs.get("e", ["0"])[0]), qs.get("s", [""])[0]
        except ValueError:
            raise ApiError(403, "bad link")
        if exp < time.time() or not hmac.compare_digest(sig, sign(name, exp)):
            raise ApiError(403, "link expired")
        p = MEDIA / name
        if not p.exists():
            raise ApiError(404, "not found")
        data = p.read_bytes()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    # ------------------------------------------------------------ routes
    def _route(self, con, method, path, qs):
        if method == "POST" and path == "/api/register":
            name = clean_text(self._json().get("name"), 30)
            if not name:
                raise ApiError(400, "pick a name")
            token = secrets.token_urlsafe(32)
            uid = secrets.token_hex(8)
            con.execute("INSERT INTO users (id, token_hash, name, code, created, last_seen) VALUES (?,?,?,?,?,?)",
                        (uid, hashlib.sha256(token.encode()).hexdigest(), name, new_code(con), now_ms(), now_ms()))
            return 200, {"ok": True, "token": token,
                         "me": user_json(con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone(), me=True)}

        if method == "POST" and path == "/api/recover":
            key = re.sub(r"[^A-Z0-9]", "", str(self._json().get("key") or "").upper())
            u = con.execute("SELECT * FROM users WHERE recovery_hash=?", (hashlib.sha256(key.encode()).hexdigest(),)).fetchone() if len(key) >= 20 else None
            if not u:
                raise ApiError(404, "that recovery key isn't right")
            token = secrets.token_urlsafe(32)          # new login for this device; friends, posts and profile are untouched
            con.execute("UPDATE users SET token_hash=?, last_seen=? WHERE id=?", (hashlib.sha256(token.encode()).hexdigest(), now_ms(), u["id"]))
            return 200, {"ok": True, "token": token, "me": user_json(con.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone(), me=True)}

        me = self._user(con)
        uid = me["id"]
        reload_me = lambda: user_json(con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone(), me=True)

        if path == "/api/me":
            if method == "GET":
                out = {"ok": True, "me": user_json(me, me=True)}
                if is_owner(con, uid):
                    out["owner"] = True
                    out["dashboard_url"] = DASHBOARD_URL
                return 200, out
            if method == "POST":
                name = clean_text(self._json().get("name"), 30)
                if not name:
                    raise ApiError(400, "pick a name")
                con.execute("UPDATE users SET name=? WHERE id=?", (name, uid))
                return 200, {"ok": True, "me": reload_me()}
            if method == "DELETE":
                files = [r[0] for r in con.execute("SELECT photo FROM posts WHERE user_id=?", (uid,))] + [me["avatar"]]
                files += [r[0] for r in con.execute("SELECT file FROM photos WHERE user_id=?", (uid,))]
                con.execute("DELETE FROM users WHERE id=?", (uid,))           # cascades to everything
                for f in files:
                    drop_media(f)
                return 200, {"ok": True}
        if method == "PUT" and path == "/api/me/avatar":
            if media_bytes_used() > MEDIA_CAP:
                raise ApiError(507, "photo storage is full")
            try:
                name = save_image(self._body(MAX_IMAGE), AVATAR_PX, square=True)
            except ValueError as e:
                raise ApiError(400, str(e))
            con.execute("UPDATE users SET avatar=? WHERE id=?", (name, uid))
            drop_media(me["avatar"])
            return 200, {"ok": True, "me": reload_me()}
        if path == "/api/owner/sessions":
            if not is_owner(con, uid):
                raise ApiError(403, "owner only")
            f = DATA / "owner_sessions.json"
            if method == "PUT":
                body = self._json(MAX_SYNC_JSON)
                sess = [x for x in (body.get("sessions") or []) if isinstance(x, dict)][:5000]
                gone = [int(x) for x in (body.get("deleted") or []) if isinstance(x, (int, float)) and not isinstance(x, bool) and x > 0][:5000]
                tmp = f.with_suffix(".tmp"); tmp.write_text(json.dumps({"updated": now_ms(), "sessions": sess, "deleted": gone})); tmp.replace(f)
                return 200, {"ok": True, "count": len(sess)}
            if method == "GET":
                return 200, {"ok": True, "sessions": json.loads(f.read_text())["sessions"] if f.exists() else []}
        if method == "POST" and path == "/api/me/recovery":
            raw = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(20))
            con.execute("UPDATE users SET recovery_hash=? WHERE id=?", (hashlib.sha256(raw.encode()).hexdigest(), uid))
            return 200, {"ok": True, "key": "-".join(raw[i:i + 5] for i in range(0, 20, 5))}
        if path == "/api/me/photos" and method == "GET":
            rows = con.execute("SELECT * FROM photos WHERE user_id=? ORDER BY date DESC, created DESC", (uid,))
            return 200, {"ok": True, "photos": [photo_json(r) for r in rows]}
        if path == "/api/me/photos" and method == "PUT":
            kind = "character" if (qs.get("kind") or [""])[0] == "character" else "progress"
            date = _date((qs.get("date") or [""])[0]) or time.strftime("%Y-%m-%d")
            try:
                lv = max(0, min(50, int((qs.get("lv") or ["0"])[0])))
            except ValueError:
                lv = 0
            if con.execute("SELECT COUNT(*) FROM photos WHERE user_id=?", (uid,)).fetchone()[0] >= MAX_PHOTOS_PER_USER:
                raise ApiError(400, "too many public photos; make some private first")
            if media_bytes_used() > MEDIA_CAP:
                raise ApiError(507, "photo storage is full")
            try:
                name = save_image(self._body(MAX_IMAGE), PROFILE_PHOTO_PX)     # re-encoded: EXIF/GPS gone
            except ValueError as e:
                raise ApiError(400, str(e))
            pid = secrets.token_hex(8)
            con.execute("INSERT INTO photos VALUES (?,?,?,?,?,?,?)", (pid, uid, kind, date, lv, name, now_ms()))
            return 200, {"ok": True, "photo": photo_json(con.execute("SELECT * FROM photos WHERE id=?", (pid,)).fetchone())}
        m = re.fullmatch(r"/api/me/photos/([0-9a-f]{16})", path)
        if m and method == "DELETE":
            r = con.execute("SELECT * FROM photos WHERE id=? AND user_id=?", (m.group(1), uid)).fetchone()
            if r:
                con.execute("DELETE FROM photos WHERE id=?", (r["id"],))
                drop_media(r["file"])
            return 200, {"ok": True, "deleted": bool(r)}
        if path == "/api/me/photos/keep" and method == "POST":
            keep = {str(x) for x in (self._json().get("ids") or [])[:MAX_PHOTOS_PER_USER] if isinstance(x, str)}
            gone = [r for r in con.execute("SELECT * FROM photos WHERE user_id=?", (uid,)) if r["id"] not in keep]
            for r in gone:
                con.execute("DELETE FROM photos WHERE id=?", (r["id"],))
                drop_media(r["file"])
            return 200, {"ok": True, "removed": len(gone)}
        if path == "/api/me/profile":
            if method == "PUT":
                prof = clean_profile(self._json(MAX_PROFILE_JSON))
                if len(json.dumps(prof)) > MAX_PROFILE_JSON:
                    raise ApiError(413, "snapshot too large")
                con.execute("INSERT INTO profiles VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated=excluded.updated",
                            (uid, json.dumps(prof), now_ms()))
                return 200, {"ok": True}
            if method == "DELETE":
                con.execute("DELETE FROM profiles WHERE user_id=?", (uid,))
                return 200, {"ok": True}
        m = re.fullmatch(r"/api/users/([0-9a-f]{16})", path)
        if m and method == "GET":
            u = con.execute("SELECT * FROM users WHERE id=?", (m.group(1),)).fetchone()
            if not u or not are_friends(con, uid, u["id"]):
                raise ApiError(404, "profile not found")
            row = con.execute("SELECT data, updated FROM profiles WHERE user_id=?", (u["id"],)).fetchone()
            nposts = con.execute("SELECT COUNT(*) FROM posts WHERE user_id=?", (u["id"],)).fetchone()[0]
            photos = [photo_json(r) for r in con.execute("SELECT * FROM photos WHERE user_id=? ORDER BY date DESC, created DESC", (u["id"],))]
            return 200, {"ok": True, "user": user_json(u), "mine": u["id"] == uid, "posts": nposts,
                         "profile": json.loads(row["data"]) if row else None, "updated": row["updated"] if row else None,
                         "photos": photos}
        if method == "POST" and path == "/api/me/code":
            con.execute("UPDATE users SET code=? WHERE id=?", (new_code(con), uid))
            return 200, {"ok": True, "me": reload_me()}

        if path == "/api/friends":
            if method == "GET":
                rows = con.execute("SELECT u.* FROM friends f JOIN users u ON u.id=f.b WHERE f.a=? ORDER BY u.name COLLATE NOCASE", (uid,))
                return 200, {"ok": True, "friends": [user_json(r) for r in rows]}
            if method == "POST":
                code = norm_code(self._json().get("code"))
                other = con.execute("SELECT * FROM users WHERE code=?", (code,)).fetchone() if code else None
                if not other:
                    raise ApiError(404, "no one has that friend code")
                if other["id"] == uid:
                    raise ApiError(400, "that's your own code")
                t = now_ms()
                con.execute("INSERT OR IGNORE INTO friends VALUES (?,?,?)", (uid, other["id"], t))
                con.execute("INSERT OR IGNORE INTO friends VALUES (?,?,?)", (other["id"], uid, t))
                return 200, {"ok": True, "friend": user_json(other)}
        m = re.fullmatch(r"/api/friends/([0-9a-f]{16})", path)
        if m and method == "DELETE":
            con.execute("DELETE FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)", (uid, m.group(1), m.group(1), uid))
            return 200, {"ok": True}

        if method == "POST" and path == "/api/posts":
            if con.execute("SELECT COUNT(*) FROM posts WHERE user_id=?", (uid,)).fetchone()[0] >= MAX_POSTS_PER_USER:
                raise ApiError(400, "post limit reached; delete some old posts")
            b = self._json()
            caption = clean_text(b.get("caption"), 500, multiline=True)
            workout = clean_workout(b.get("workout"))
            if not caption and not workout:
                raise ApiError(400, "nothing to post")
            pid = secrets.token_hex(8)
            con.execute("INSERT INTO posts (id, user_id, created, caption, workout) VALUES (?,?,?,?,?)",
                        (pid, uid, now_ms(), caption, json.dumps(workout) if workout else None))
            return 200, {"ok": True, "post": post_json(con, con.execute("SELECT * FROM posts WHERE id=?", (pid,)).fetchone(), uid)}

        m = re.fullmatch(r"/api/posts/([0-9a-f]{16})(/photo|/like|/comments)?", path)
        if m:
            p = con.execute("SELECT * FROM posts WHERE id=?", (m.group(1),)).fetchone()
            if not p or not are_friends(con, uid, p["user_id"]):
                raise ApiError(404, "post not found")
            sub = m.group(2)
            if sub is None and method == "DELETE":
                if p["user_id"] != uid:
                    raise ApiError(403, "not your post")
                con.execute("DELETE FROM posts WHERE id=?", (p["id"],))
                drop_media(p["photo"])
                return 200, {"ok": True}
            if sub == "/photo" and method == "PUT":
                if p["user_id"] != uid:
                    raise ApiError(403, "not your post")
                if media_bytes_used() > MEDIA_CAP:
                    raise ApiError(507, "photo storage is full")
                try:
                    name = save_image(self._body(MAX_IMAGE), PHOTO_PX)
                except ValueError as e:
                    raise ApiError(400, str(e))
                con.execute("UPDATE posts SET photo=? WHERE id=?", (name, p["id"]))
                drop_media(p["photo"])
                return 200, {"ok": True, "post": post_json(con, con.execute("SELECT * FROM posts WHERE id=?", (p["id"],)).fetchone(), uid)}
            if sub == "/like" and method == "POST":
                if con.execute("SELECT 1 FROM likes WHERE post_id=? AND user_id=?", (p["id"], uid)).fetchone():
                    con.execute("DELETE FROM likes WHERE post_id=? AND user_id=?", (p["id"], uid)); liked = False
                else:
                    con.execute("INSERT INTO likes VALUES (?,?,?)", (p["id"], uid, now_ms())); liked = True
                n = con.execute("SELECT COUNT(*) FROM likes WHERE post_id=?", (p["id"],)).fetchone()[0]
                return 200, {"ok": True, "liked": liked, "likes": n}
            if sub == "/comments":
                if method == "GET":
                    rows = con.execute("SELECT c.*, u.name, u.avatar FROM comments c JOIN users u ON u.id=c.user_id "
                                       "WHERE c.post_id=? ORDER BY c.created", (p["id"],))
                    return 200, {"ok": True, "comments": [
                        {"id": r["id"], "text": r["text"], "created": r["created"],
                         "author": {"id": r["user_id"], "name": r["name"], "avatar": media_url(r["avatar"])},
                         "mine": r["user_id"] == uid, "can_delete": r["user_id"] == uid or p["user_id"] == uid} for r in rows]}
                if method == "POST":
                    text = clean_text(self._json().get("text"), 300, multiline=True)
                    if not text:
                        raise ApiError(400, "write something")
                    cid = secrets.token_hex(8)
                    con.execute("INSERT INTO comments VALUES (?,?,?,?,?)", (cid, p["id"], uid, now_ms(), text))
                    return 200, {"ok": True, "comment": {"id": cid, "text": text, "created": now_ms(),
                                                         "author": user_json(me), "mine": True, "can_delete": True}}
        m = re.fullmatch(r"/api/comments/([0-9a-f]{16})", path)
        if m and method == "DELETE":
            c = con.execute("SELECT c.user_id, p.user_id AS owner FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=?",
                            (m.group(1),)).fetchone()
            if not c or uid not in (c["user_id"], c["owner"]):
                raise ApiError(404, "comment not found")
            con.execute("DELETE FROM comments WHERE id=?", (m.group(1),))
            return 200, {"ok": True}

        if method == "GET" and path == "/api/feed":
            try:
                before = int(qs.get("before", [str(now_ms() + 1)])[0])
            except ValueError:
                before = now_ms() + 1
            rows = con.execute(
                "SELECT * FROM posts WHERE created < ? AND (user_id=? OR user_id IN (SELECT b FROM friends WHERE a=?)) "
                "ORDER BY created DESC LIMIT ?", (before, uid, uid, FEED_PAGE)).fetchall()
            return 200, {"ok": True, "posts": [post_json(con, r, uid) for r in rows]}

        raise ApiError(404, "not found")


MEDIA_KEY = b""


def main():
    global MEDIA_KEY
    init_db()
    MEDIA_KEY = media_key()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print("gym-social on :%d (data %s)" % (PORT, DATA), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
