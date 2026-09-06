# Chalkline

A shared whiteboard for live online maths classes, built around an equation
editor students can actually use.

**Live:** https://chalklineschool.com/

## To change something

```bash
python3 build.py     # app.html  ->  chalkline-board.html + index.html
./run-tests.sh       # 22 suites
```

`app.html` is the only file you edit. `index.html` is what goes on GitHub Pages.

`CLAUDE.md` is the guide — architecture, conventions, traps, and what to build
next. Read that first.

Sign-in is Clerk, the database is Supabase. If `supabase-schema.sql` changes,
`build.py` writes `supabase-schema.local.sql` — paste that into Supabase's SQL
editor. `git push` deploys.

## First time on a new machine

```bash
npm install
npx playwright install chromium
```
