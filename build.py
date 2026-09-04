#!/usr/bin/env python3
"""
Build Chalkline.

    python3 build.py

app.html is the ONLY file you edit. This wraps it in a page skeleton and
writes two things:

    chalkline-board.html   the app with no Firebase settings — works between
                           windows on one computer, used by the test suites
    index.html             the same app with firebase-config.json filled in —
                           this is the file that goes on GitHub Pages

Keeping the configured and unconfigured builds separate means the tests never
touch the real database, and the settings live in one place instead of being
pasted in by hand after every build.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLACEHOLDER = "you@example.com"

BLANK = '''window.CHALKLINE_FIREBASE = {
  apiKey:      "",
  authDomain:  "",
  databaseURL: "",
  projectId:   "",
  appId:       ""
};'''


def wrap(src_path):
    body = open(src_path, encoding="utf-8").read()
    head, rest = body.split("<style>", 1)
    style, after = rest.split("</style>", 1)
    return ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            + head.rstrip() + "\n<style>" + style + "</style>\n</head>\n<body>\n"
            + after.lstrip("\n") + "\n</body>\n</html>\n")


def configured(page, cfg):
    filled = 'window.CHALKLINE_FIREBASE = {\n' + "".join(
        '  %-12s "%s",\n' % (k + ":", cfg.get(k, ""))
        for k in ("apiKey", "authDomain", "databaseURL", "projectId", "appId")
    ).rstrip(",\n") + "\n};"
    if BLANK not in page:
        sys.exit("build: the settings block in app.html has changed shape — "
                 "update BLANK in build.py to match it")
    return page.replace(BLANK, filled, 1)


def schema():
    """Fill the teacher's real email into the Supabase schema.

    supabase-schema.sql is the tracked copy and carries a placeholder, so that
    publishing the source does not publish a personal email address. This
    writes supabase-schema.local.sql beside it with the real one filled in —
    the file to paste into the Supabase SQL editor. Git ignores it.

    Same arrangement as app.html -> index.html: the settings live in one
    place instead of being edited by hand after every change.
    """
    src = os.path.join(HERE, "supabase-schema.sql")
    if not os.path.exists(src):
        return
    cfg_path = os.path.join(HERE, "chalkline-local.json")
    cfg = json.load(open(cfg_path, encoding="utf-8")) if os.path.exists(cfg_path) else {}
    email = (cfg.get("teacherEmail") or "").strip()
    sql = open(src, encoding="utf-8").read()
    if not email:
        print("note: chalkline-local.json has no teacherEmail, so the SQL was "
              "not filled in — nobody would be recognised as the teacher")
        return
    if PLACEHOLDER not in sql:
        sys.exit("build: the teacher line in supabase-schema.sql has changed "
                 "shape — update PLACEHOLDER in build.py to match it")
    out = os.path.join(HERE, "supabase-schema.local.sql")
    open(out, "w", encoding="utf-8").write(sql.replace(PLACEHOLDER, email))
    print("built %s  — paste this one into Supabase (%s)"
          % (os.path.basename(out), email))


def main():
    page = wrap(os.path.join(HERE, "app.html"))
    out = os.path.join(HERE, "chalkline-board.html")
    open(out, "w", encoding="utf-8").write(page)

    cfg_path = os.path.join(HERE, "firebase-config.json")
    cfg = json.load(open(cfg_path, encoding="utf-8")) if os.path.exists(cfg_path) else {}
    site = os.path.join(HERE, "index.html")
    open(site, "w", encoding="utf-8").write(configured(page, cfg))

    ver = re.search(r'class="ver">([^<]+)<', page)
    print("built %s (%d bytes)" % (os.path.basename(out), len(page)))
    print("built %s  — the file that goes on GitHub" % os.path.basename(site))
    print("version: %s" % (ver.group(1) if ver else "?"))
    schema()

    if not cfg.get("apiKey"):
        print("note: firebase-config.json has no apiKey, so index.html will "
              "only work between windows on one computer")


if __name__ == "__main__":
    main()
