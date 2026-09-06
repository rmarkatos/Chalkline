# Chalkline

A shared whiteboard for live online maths classes. Students type mathematics
that looks like mathematics; the teacher watches every board in real time,
pushes problems, writes feedback, and marks work correct.

Built for Ryan Markatos, who teaches Honors Algebra II & Trig and AP Calculus
over Zoom. The whole point is the equation editor: LaTeX is the right way to
write mathematics, but making students learn LaTeX is not an option.

Live at **https://chalklineschool.com/**

Sign-in is **Clerk** (email, no Google). The database is **Supabase**. Both
publishable keys sit in the page by design; access is decided by the rules in
`supabase-schema.sql`. Neither service's *secret* key belongs anywhere near
this repo — `build.py` refuses to build if one appears in a config file.

---

## The one rule

**`app.html` is the only file you edit.** Everything else is generated or
supporting. After any change:

```bash
python3 build.py       # writes chalkline-board.html and index.html
./run-tests.sh         # runs all 22 suites, prints one line each
git push               # deploys — index.html on main IS the live site
```

**If `supabase-schema.sql` changed**, the database has to change with it:
`build.py` also writes `supabase-schema.local.sql` with Ryan's email filled
in, and he pastes that into Supabase → SQL Editor → Run. The app and the
schema must ship together. The file is safe to re-run — it never drops a
table or a row, only rewrites the policies.

**Pushing to `main` deploys.** For anything half-built, work on a branch.

`index.html` is what goes on GitHub Pages. `chalkline-board.html` is the same
app with **no settings at all** — no Firebase, no Supabase, no Clerk. The tests
drive it, so they never touch the real database or a real account.

There is a version chip on screen (`v31` at the time of writing). **Bump it in
`app.html` on every ship — one ship, one bump.** Several hours were lost to
not doing that once; then on 2026-09-04 about ten builds went out all
labelled v28 and caused exactly the stale-page confusion the chip exists to
prevent. There are four chips in the file (landing, splash, board, wall);
replace `class="ver">vNN<` everywhere.

---

## Layout of app.html

One file, in this order. The section comments in the file are the real map;
this is the shape of it.

| Part | What lives there |
| --- | --- |
| Settings block | `window.CHALKLINE_FIREBASE` — hoisted to the top so it can be edited on GitHub without scrolling past the stylesheet |
| Stylesheet | All of it, inline |
| Markup | Three screens: landing, student board, teacher wall |
| 1. Model | An expression is a list of nodes; a node with sub-expressions holds them in `node.s = [list, …]` (slots, in navigation order) |
| 2. Serialiser / parser | `texList()` writes LaTeX, `parseTex()` reads it. These must stay inverse to each other — see Testing |
| 3. Board state | `lines[]`, `cur = {list, i}`, `sel` |
| 4. Rendering | `renderList` / `renderNode` build DOM; `renderStatic` is the read-only version used by tiles and panels |
| 5. Typing | `typeChar`, `typePending` (raw LaTeX), `backspace`, arrows, shortcuts |
| 6. Palette | `PALETTE` is a table of panels → buttons → `act()` |
| 7. Graphing | Numeric evaluator, `FAMILIES`, `drawPlot`, the graph line kind |
| 8. Sharing | `LocalSync` / `FirebaseSync` behind one small interface, then the teacher wall, feedback, notes, problems, timer |

### Declarations must be hoisted

`render()` runs during start-up, long before the sharing section is reached.
Any `let`/`const` it touches has to be declared with the other shared state near
the top (`sync`, `holdPublish`, `problemItems`, `noteMap`, `myNotes`, …).
**This has caused a blank page five separate times** (`test-boot.js` now catches it). If the page loads to
nothing, open the console: it will say *"Cannot access X before
initialization"*.

---

## How sharing works

One interface, two implementations:

```js
sync.on(type, fn)   sync.send(type, payload)   sync.ready(fn)
sync.close()  sync.wipe()  sync.now()  sync.drop(id)
```

Three implementations now. `makeSync` picks: **`SupabaseSync`** when the
Supabase and Clerk settings are both filled in, `FirebaseSync` when only the
Firebase ones are, and `LocalSync` (BroadcastChannel, no account) when none
are — which is every test run.

`SupabaseSync` has no `onDisconnect`. Firebase could be told "delete this row
if the tab vanishes" and would honour it server-side; Postgres cannot. It
turns out not to matter: a board carries a heartbeat and the wall already
sweeps anything quiet for 30s, so the sweep was doing the real work all along. Message types: `board`, `problem`,
`feedback`, `check`, `timer`, `close`, `end`, `gone`, `reconnected`.

### Shape in the database

```
rooms/<CODE>/
  boards/<id>     {name, lines[], ids[], at}     written by that student alone
  feedback/<id>   {lines[], notes:{lineId: latex}}
  checks/<id>     true | false
  problem         {items:[{lines[], images[]}], at}
  timer           {endsAt}          server time, so late joiners agree
  closed          <timestamp>       negative means "session ended"
```

A **line of work is a string**, always. A graph line encodes as
`"%%G " + JSON.stringify(...)` — `%` opens a comment in LaTeX, so it is
metadata by construction. This is why adding graphs needed no change to the
sync layer at all. Keep it that way.

### Identity — read this before touching it

**This was reversed deliberately in v28.** Chalkline used to let anyone with
the class code walk in, and went out of its way to make every tab and every
visit a student who had never been there before. Ryan decided he did not want
anyone joining anonymously. So:

- **A student is a person, not a tab.** They sign in with Clerk, and their
  student id is their Clerk user id. Two tabs are the same student and share
  a board — which is what anyone would expect, and the opposite of what the
  old `TAB_TAG` existed to arrange. `TAB_TAG` only mattered because anonymous
  sign-in handed out one id per browser.
- **The class code is no longer a gate.** It was a word the teacher typed,
  defaulting to `ALG2`, and anyone who guessed it was in. The roster is the
  gate now: a student picks Algebra 2 or AP Calculus AB and waits for Ryan to
  approve them.
- **A change to the rules needs `supabase-schema.sql` re-run.** Ryan runs
  `python3 build.py`, which writes `supabase-schema.local.sql` with his email
  filled in, and he pastes that into the Supabase SQL editor. He never edits a
  line by hand — that is a hard rule.
- The old Firebase path is still in the file and still tested. It is what runs
  when the settings blocks are empty, which is every test run.

### Nothing outlives the lesson

No student work is ever saved. Sign out erases every class code opened in the
session (two clicks — the button relabels itself first). Close the board erases
the room. Closing the tab erases it too, via `onDisconnect`. On reconnect the
teacher republishes the problem, timer, feedback and checkmarks it still holds
in memory, which is what makes that safe.

A tile means a student is in the room **now**: boards go stale after 30s
without a heartbeat and are swept, so an absent student never appears.

---

## Testing

22 suites, ~570 assertions plus 500 generated round-trips.

```bash
./run-tests.sh            # everything
./run-tests.sh graph      # only suites matching "graph"
node test-notes.js        # one suite, full output
```

They drive real Chromium through Playwright against the built file. Firebase is
replaced by **`fake-firebase.js`** (an in-memory database replicated between
pages over BroadcastChannel) and **`fake-firebase-rules.js`**, which is the same
thing *plus* an enforcement of the published rules. `test-rules.js` runs a whole
classroom against the enforcing one and asserts that **no page's error banner
appears** — if any subscription asked for something the rules refuse, it would.

### Two disciplines that have repeatedly paid off

**The parser and the serialiser are tested against each other, not against a
list.** `test-parser.js` generates 500 random expressions in the serialiser's
own output format and asserts `parse(s)` is a fixed point. That catches classes
of bug no hand-written case would.

**Start-up is tested with the accounts settings filled in.** Every other suite
drives `chalkline-board.html`, where the settings are empty and none of the
accounts code runs — so nothing could catch a mistake in it. `test-boot.js`
builds a copy with settings pointing at nowhere and asserts the script reaches
the end. It exists because `accountsReady` was declared in section 9 while
`boot()` runs long before section 9 — the fifth time that trap has bitten, and
the first time it reached the live site.

**A test that cannot fail is not a test.** When you fix a bug, first make the
test fail against the old behaviour, then fix it. `test-tabs.js` passed *before*
the identity fix, because the stand-in gave every tab its own uid — the opposite
of the real SDK. The stand-in had to be corrected before the test meant
anything.

This has now happened twice more. `test-schema.js` failed everywhere until its
stand-in granted `authenticated` access to the `auth` schema, which real
Supabase does. And the first `test-boot.js` passed happily against the exact
bug that had just reached the live site, because start-up catches its own
exceptions to show a sentence rather than a blank screen — so the browser
never reported one. It now reads the error off the screen as well.

### Regenerating the enforcing stand-in

`fake-firebase-rules.js` is `fake-firebase.js` plus a `guard()` function. If you
edit the base file, regenerate it — the guard block is copied in verbatim after
`localWrite`, and `set`/`remove`/`add` are wrapped. Keep the two in step or the
rules suites test yesterday's code.

---

## Things that look like bugs and are not

- **`file://`** — opening the downloaded `index.html` from a Downloads folder
  half-works: it says "live", but sign-in, storage and the student link all
  behave differently. The page now shows a band across the top saying so.
- **Google's secret scanner** flags the Firebase web API key on every push. It
  is an identifier, not a credential; Google's own docs say so. Close the alert
  as a false positive. Access is decided by the rules.
- **A student who reloads mid-lesson** is the same student — they have an
  account now. (Before v28 they became a new one; that was the cost of "every
  visit is a first visit", which no longer applies.)
- **A stale page.** After a deploy, a normal reload can serve the previous
  build for a while. Half of one evening's confusion was a student window on
  the old build. `⌘⇧R`, or a fresh private window, before believing a bug.
- **"Couldn't find your account."** Clerk's box defaults to *Sign in*; a new
  person needs *Sign up*, the small link underneath. Every first-timer hits
  this, Ryan included.
- **Testing as a student on your own machine.** A Gmail address with a `+tag`
  (`name+test1@gmail.com`) is a separate account to Clerk but lands in the
  same inbox, so the verification code is readable. Use a private window —
  a second tab shares the sign-in.
- **Supabase's live updates do not arrive.** Established in real use: the
  waiting queue stayed empty, a pushed picture never reached students (the
  timer did — it is small), and the wall stopped hearing about boards. The
  cause has not been pinned down; plausibly Realtime never received the Clerk
  token. The app no longer depends on it — see *Ask, as well as listen*.

---

## Where it stands

**Equation editor.** Typing, raw LaTeX, inline text (`$` toggles mid-line),
fractions, radicals, scripts, big operators, matrices, cases. Palette panels:
Templates, Operators, Number sets and symbols, Calculus, Trigonometry,
Exponents & logs. Brackets are typed as characters and only pair with their own
partner, so `[)` stays as typed. The space bar inserts a space everywhere
except straight after a `\command` and at the end of a script, where LaTeX
itself spends it.

**Accounts and the roster (v28).** Everybody signs in with Clerk — email and
password, no Google, by Ryan's choice. A student picks **Algebra 2** or
**AP Calculus AB** on a splash screen and waits; Ryan sees *N waiting* on his
wall with Approve / Not in this class. Approval is once, not per lesson. A
removed student is not offered the class again. Ryan never appears in his own
queue. Confirmed working with real students on other machines.

**The splash always shows the choice.** An approved student is *not* sent
straight to a board. `splashPlan(classes, enrolments)` — pure, tested in
`test-boot.js` — decides what each class row is: **open** (approved),
**waiting** (asked), **ask** (neither), absent (removed). Ryan asked for
this after the first version auto-joined; it also makes a student in two
classes just two open rows rather than a special case. The 4s splash poll
only redraws when the plan changes, so buttons are not rebuilt under a
finger. Leaving a board lands on a resting screen with *Open my board
again* and *Sign out* — never the class-code form, which no longer exists.

**Teacher presence (v29).** On a student's screen **LIVE means the teacher is
on this class's wall**, not "connected"; otherwise the chip reads *waiting
for teacher* and the top bar shows *"Mr. Markatos is logged in"* only while
he is. The wall upserts `sessions.teacher_at` (and `teacher_name`, from
`my_teacher_name()` — the one thing the unreadable `teachers` table gives
out, and only about yourself) every 5s; students already poll that row, and
`teacherPresent(row, now)` — pure, tested — counts under 20s as here.
`stopTeacherBeat()` clears it on Leave so students see the change at once.

**v30–v31.** When the clock runs out the problem strip fades (`.expired`,
toggled where "time's up" is decided); a newly pushed problem glows and
scrolls into view — `itemKeys()`/`newItemIndices()` are pure and tested,
and use the same recipe as `stripKey()` so "changed" and "which" cannot
disagree. The `.topbar` is sticky (same class on the board and the wall).
Each wall tile shows *joined 10:42*: `boards.joined_at` is set by the
database on insert and **never sent by the app**, so an upsert leaves it
alone; a re-join after the row was swept is a new row and a new time.
The display name lives in `chalkline-local.json` (`teacherName`) and is
filled into the seed by `build.py` like the email. Also v29: class *names*
in the student top bar (`roomLabel()`), the splash centred like the landing
box, and the palette scrollbar in theme tokens.

**Classroom.** The wall, push a problem (PNG or PDF, several stack up), a
timer that locks input, feedback, per-line notes, a checkmark. All unchanged
above the sync layer.

### Ask, as well as listen

`SupabaseSync` subscribes to live changes **and re-reads every piece of its
state every 2.5 seconds** — boards, feedback, checks, problem, timer, session.
The approvals queue and the waiting student's page poll too. This is
deliberate, not a stopgap:

- The live channel can fail to start for reasons nothing on screen explains,
  and it drops messages too big to carry. Both happened.
- The consequence was not just a quiet wall. The wall sweeps any board silent
  for 30s **and asks the database to delete it**. A wall that has stopped
  hearing decides everyone has left and erases work students are still
  writing. That is why `drop(id)` now only deletes a row whose own timestamp
  is over 30s old — the database judges, not a page that may not be listening.
- The problem is always re-read from its row, never taken from the
  notification. A pushed picture is far larger than a live message carries.

If Realtime is ever made to work, keep the polling. It is cheap and it cannot
silently stop.

**Polling has a cost: every handler must treat a repeat as a repeat.** The
sync layer announces the *same* state every 2.5s. Two bugs came from
handlers that treated each announcement as news: `startTimer` began by
unlocking, so once a timer ran out the board unlocked every 2.5s and
students kept typing; and the problem handler re-showed the strip every
2.5s after a student clicked Hide. Now a timer carries `endsAt` as its
identity and `startTimer` ignores one it has already heard; `seconds:0`
*with* an `endsAt` means "ran out" (lock, and stay locked) while
`seconds:0` without one means "no timer" (unlock). The problem handler
compares `stripKey()` before and after and only acts on a change. **A new
problem is what unlocks a board whose time ran out** — that is Ryan's rule.
`asProblems` takes the whole row, as it took the whole Firebase node;
handing it just `.items` made every pushed problem invisible.

**Graphing.** Students state *key features* — asymptote, intercepts, base — and
the curve is drawn from them; the equation appears only when they ask for it,
so it confirms their algebra. One family so far: **logarithmic**.

### Next

1. **Roster management.** The wall shows only who is *waiting*. There is no
   list of who is already approved and no way to remove someone, and a
   student who picks the wrong class cannot be moved. Short job; the
   `enrolments` table and policies already allow all of it.
2. **Clerk's box should open on Sign up**, not Sign in. Every new person's
   first action is Sign up and the link is small.
3. **A test that drives `SupabaseSync`.** The 11 database suites still drive
   the Firebase path, which is what runs when settings are empty. Nothing
   automated exercises the Supabase path; real students found the last two
   bugs. A stand-in for Supabase, or the schema suite's PGlite, is the way in.
4. **Then graphing**, unchanged from before: a family picker first (every
   graph line is logarithmic), then linear and quadratic, then exponential.
   `FAMILIES` is a table; each entry declares its features and how to solve
   itself. Rational needs renderer work for poles. **Trig needs parameter
   inputs, not points.**
5. **The Firebase path can go** once (3) exists. Until then it is the only
   thing the database suites test, so it stays.

---

## Files

| File | |
| --- | --- |
| `app.html` | the source — the only file you edit |
| `build.py` | writes both builds |
| `supabase-config.json` | Supabase address + publishable key, injected at build time |
| `clerk-config.json` | Clerk publishable key, injected at build time |
| `firebase-config.json` | the old Firebase settings — still injected, only used when the two above are empty |
| `chalkline-local.json` | Ryan's email and display name. **Git-ignored. Never leaves the laptop.** |
| `supabase-schema.sql` | the database and rules — the replacement for `firebase-rules.json`. Placeholder email |
| `supabase-schema.local.sql` | the same with the real email, written by `build.py`. **Git-ignored.** This is what gets pasted into Supabase |
| `index.html` | built + configured — this is what goes on GitHub Pages |
| `chalkline-board.html` | built, no settings at all — what the tests drive |
| `CNAME` | tells GitHub Pages the domain is `chalklineschool.com` |
| `firebase-rules.json` | the old rules. Kept for the Firebase path; placeholder email |
| `diagnose.html` | checks the *Firebase* setup step by step. Not updated for Supabase |
| `run-tests.sh` | all suites, one line each |
| `test*.js` | the suites |
| `test-schema.js` | runs the schema against real Postgres (PGlite) and tries to break the rules as four different people |
| `test-boot.js` | the only suite that runs with accounts *on* — settings pointed at nowhere — to catch a declaration used before it is reached |
| `fake-firebase*.js` | the stand-in Firebase, with and without rules enforcement |
