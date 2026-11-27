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
MAX_PROFILE_JSON = 64 * 1024
MAX_SYNC_JSON = 6 * 1024 * 1024          # owner-only workout sync (whole history, a few hundred KB in practice)
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "")   # shown to the owner only, never baked into the public app
MAX_IMAGE = 8 * 1024 * 1024          # upload cap; the app resizes to ~1600px first, so ~0.3-1 MB
PHOTO_PX, AVATAR_PX = 1600, 256
MEDIA_TTL = 6 * 3600                 # signed media links last 6 h (feeds are refetched often)
MEDIA_CAP = 5 * 1024 ** 3            # refuse new photos past 5 GB total (protects the disk)
MAX_POSTS_PER_USER = 2000
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
    """)
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


def clean_profile(b):
    """Whitelist the profile snapshot (level, muscle levels, headline stats, recent workouts) friends can view."""
    num = lambda v, lo, hi: max(lo, min(hi, float(v))) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0
    muscles = []
    for m in (b.get("muscles") or [])[:30]:
        if isinstance(m, dict) and m.get("name"):
            muscles.append({"name": clean_text(m["name"], 30), "level": clean_text(m.get("level"), 20),
                            "score": round(num(m.get("score"), -1, 5), 2), "lift": clean_text(m.get("lift"), 60)})
    st = b.get("stats") if isinstance(b.get("stats"), dict) else {}
    workouts = []
    for w in (b.get("workouts") or [])[:20]:
        cw = clean_workout(w)
        if cw:
            cw["lifts"] = cw["lifts"][:6]
            workouts.append(cw)
    return {"lv": int(num(b.get("lv"), 0, 50)), "tier": clean_text(b.get("tier"), 20),
            "score": round(num(b.get("score"), -1, 5), 3), "xp": round(num(b.get("xp"), 0, 1), 3),
            "muscles": muscles,
            "stats": {"workouts": int(num(st.get("workouts"), 0, 100000)), "volume": int(num(st.get("volume"), 0, 1e9)),
                      "streak_weeks": int(num(st.get("streak_weeks"), 0, 1000)), "avg_week": round(num(st.get("avg_week"), 0, 50), 1),
                      "since": clean_text(st.get("since"), 10)},
            "workouts": workouts}


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
            if path == "/api/register":
                kind = "register"
            if limited(self._ip(), kind):
                raise ApiError(429, "slow down")
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
                tmp = f.with_suffix(".tmp"); tmp.write_text(json.dumps({"updated": now_ms(), "sessions": sess})); tmp.replace(f)
                return 200, {"ok": True, "count": len(sess)}
            if method == "GET":
                return 200, {"ok": True, "sessions": json.loads(f.read_text())["sessions"] if f.exists() else []}
        if path == "/api/me/profile":
            if method == "PUT":
                prof = clean_profile(self._json(MAX_PROFILE_JSON))
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
            return 200, {"ok": True, "user": user_json(u), "mine": u["id"] == uid, "posts": nposts,
                         "profile": json.loads(row["data"]) if row else None, "updated": row["updated"] if row else None}
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
