"""Owner-only admin tool for the gym-social server. Runs on the server only (no HTTP endpoint):

  docker exec gym-social python /app/admin.py list
  docker exec gym-social python /app/admin.py reissue <name-or-id>

list     users: id, display name, created, last seen, friend count (no secrets).
reissue  mints a NEW login token for one user, exactly like /api/recover does (friends, posts, profile,
         photos and the recovery key are untouched; the old login stops working at once) and prints a
         one-off login link (<app>#social-login=<token>) to send to that person privately. Every reissue
         is written to the admin_audit table (who, when). Token hashes and recovery keys are never printed.
"""
import hashlib
import os
import secrets
import sqlite3
import sys
import time

import social

APP_URL = os.environ.get("ADMIN_APP_URL", "https://teo2301.github.io/gym-companion/")


def connect():
    if not social.DB_PATH.exists():
        raise SystemExit("no database at %s" % social.DB_PATH)
    social.init_db()                       # same schema/migrations as the server (idempotent)
    con = social.db()
    con.execute("""CREATE TABLE IF NOT EXISTS admin_audit (
      at INTEGER NOT NULL, action TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, by TEXT NOT NULL)""")
    return con


def fmt_ms(ms):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000)) if ms else "never"


def list_users(con):
    rows = con.execute("""SELECT u.id, u.name, u.created, u.last_seen,
        (SELECT COUNT(*) FROM friends f WHERE f.a = u.id) AS friends   -- stored both ways
        FROM users u ORDER BY u.created""").fetchall()
    return [dict(r) for r in rows]


def find_user(con, who):
    who = (who or "").strip()
    if not who:
        raise LookupError("give a name or an id")
    r = con.execute("SELECT * FROM users WHERE id=?", (who,)).fetchone()
    if r:
        return r
    hits = con.execute("SELECT * FROM users WHERE lower(name)=lower(?)", (who,)).fetchall()
    if not hits:
        raise LookupError("no user called or with id %r (try: admin.py list)" % who)
    if len(hits) > 1:
        raise LookupError("%d users are called %r, use the id: %s" % (len(hits), who, ", ".join(h["id"] for h in hits)))
    return hits[0]


def reissue(con, who, by=None):
    """New login token for one user (same as /api/recover). Returns (user row, token)."""
    u = find_user(con, who)
    token = secrets.token_urlsafe(32)
    by = by or os.environ.get("SUDO_USER") or os.environ.get("USER") or "owner"
    con.execute("BEGIN IMMEDIATE")
    try:
        con.execute("UPDATE users SET token_hash=? WHERE id=?", (hashlib.sha256(token.encode()).hexdigest(), u["id"]))
        con.execute("INSERT INTO admin_audit VALUES (?,?,?,?,?)", (social.now_ms(), "reissue", u["id"], u["name"], by))
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    return u, token


def login_link(token):
    return APP_URL.split("#")[0] + "#social-login=" + token


def main(argv):
    if len(argv) < 2 or argv[1] not in ("list", "reissue") or (argv[1] == "reissue" and len(argv) < 3):
        print(__doc__.strip())
        return 2
    con = connect()
    if argv[1] == "list":
        users = list_users(con)
        print("%-16s  %-24s  %-16s  %-16s  %s" % ("id", "name", "created", "last seen", "friends"))
        for u in users:
            print("%-16s  %-24s  %-16s  %-16s  %d" % (u["id"], u["name"][:24], fmt_ms(u["created"]), fmt_ms(u["last_seen"]), u["friends"]))
        print("%d user(s)" % len(users))
        return 0
    try:
        u, token = reissue(con, " ".join(argv[2:]))
    except LookupError as e:
        print("error: %s" % e, file=sys.stderr)
        return 1
    print("New login for %s (%s). Their old login has stopped working; friends, posts and profile are kept." % (u["name"], u["id"]))
    print("Send them this link privately (anyone with it can sign in as them):")
    print(login_link(token))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
