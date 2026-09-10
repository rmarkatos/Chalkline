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
./run-tests.sh         # runs all 24 suites, prints one line each
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

There is a version chip on screen (`v48` at the time of writing). **Bump it in
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
  boards/<id>     {name, lines[], ids[], at, awaySince}   written by that student alone
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

24 suites, ~770 assertions plus 500 generated round-trips.

```bash
./run-tests.sh            # everything
./run-tests.sh graph      # only suites matching "graph"
node test-notes.js        # one suite, full output
```

They drive real Chromium through Playwright against the built file. **The
database path has its own suite since v48**: `test-supabase.js` fills the
accounts settings into a copy of the page and answers the two library
downloads with **`fake-clerk.js`** and **`fake-supabase.js`**, so
`SupabaseSync`, the splash, the approvals queue and the wall run exactly as
written against an in-browser database. That stand-in reads the column list
out of `supabase-schema.sql` and refuses an unknown column with PGRST204,
as PostgREST does, and it delivers no live updates, as the real one never
did. Its first run found a live bug (see v48). The older suites: Firebase is
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

**A suite that prints nothing did not run.** Splicing a new block onto a
test file cut off its ending (summary, browser close, helper) and the file
no longer parsed — three runs printed no summary and no FAIL, which is not
"green". `node --check <suite>` after editing one, and treat an empty
result as red. The runner already refuses to call a crashed suite green.

**A break-on-purpose that crashes the suite proves nothing.** Disabling the
pop-out to prove its check made the very next step throw on a missing
button, so the run died before the *footer* check it was also meant to
prove — and the summary line never printed. Guard the steps after a check
(`if(b) …`) so a broken rule fails *one* check cleanly, and read the
summary line, not just the FAIL lines.

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
- **`test-presence.js` failing once in a blue moon** — *"cleared out rather
  than left lying around"*. It polls for a background removal; under the
  load of a full run that occasionally took longer than the 3s it allowed.
  It allows 6s now. That was the whole of a night's "flake".
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

**One workspace per pushed problem (v32).** A heading is a line of work that
is a string — `"%%P {"label":"Problem 2"}"` — exactly like a graph line, so
the sharing layer, the database and the wall carry it unchanged. Everything
after the *last* heading is the workspace the student is in; everything
before it is **frozen**: still on screen, greyed, `pointer-events:none`, and
`typeChar`/`backspace` refuse it, ArrowUp stops at the first line of the
workspace, `removeLine` never lands the caret on a heading, and *Clear
board* clears only the workspace in use (`clearActive`). A new problem calls
`openWorkspace(label)`: work done before the first problem is kept under
*Earlier work* unless the board was empty. Tiles showed only the workspace in
use until v46; now a tile shows every workspace and the open panel does too. `tex()` in the
test hooks skips headings. `test-workspaces.js` drives two students and a
teacher end to end.

**v48 — a "newer version" notice; the database path under test; a delete
that never ran.** Three things.
1. *A newer version of Chalkline is out — Reload.* `checkLiveVersion()`
   fetches the page itself every three minutes (`cache:"no-store"`, only
   when the tab is visible, only over http/https), reads the chip out of
   it (`liveVersionOf`) and shows `#verBar` when the live number is
   **greater** than `APP_VERSION` — an older copy from a cache must not
   raise it. Nobody is reloaded without clicking. Hooks `version()` and
   `liveVersion(html)`; `test-workspaces` covers newer/same/older/no chip.
2. `test-supabase.js` — see Testing. 55 checks: sign-in as teacher and as
   students, ask/approve, the board on the wall, a pushed problem with a
   timer, feedback, a per-workspace mark, away and back, a student on a
   database that has not had the latest paste (the v47 fallback), a stale
   row dropped while a live one survives an impatient wall, the mounted
   sign-in box, leaving, and ending the lesson.
3. **The bug it found on its first run.** supabase-js only sends a query
   when something calls `.then()` on it (awaits it). `SupabaseSync.close()`
   built its "delete my board" query and dropped it, and `drop(id)` returned
   its builder to callers that never awaited it — so *neither ever ran on
   the live site*. A student who left stayed on the wall until the 30s
   sweep, and stale rows were never cleaned up. Both now end in `.then()`.
   Rule: **a supabase-js query that is not awaited did not happen.**
   Falsified: removing the `.then()` reds "leaving removes the board row".

**v47 — the fallback is judged per write.** At v46 a student page showed
*writing your board: PGRST204* before chalkline-06 was pasted: two board
writes went out together at start-up, both were refused, the first set
`noAwayColumn` and re-sent, the second saw the flag already set and
reported instead. The retry now checks `"away_since" in row` for its own
row, so every refused write re-sends itself. Ryan's forgot-password flow is
confirmed working (tested by him, 2026-09-09).

**v46 — the whole board on a tile; a red tile when a student leaves the
screen.** Ryan: "On the teacher's overview of each student panel, I am only
seeing the work they have typed into the latest question." `paintTile` no
longer passes `"active"` to `renderStatic`: a tile shows every workspace,
line numbers restart under each heading (as on the board), and the cap
before *+N more* is 18 rows, not 7. And: "If the student leaves the screen
I want their panel highlighted red ... I also want the time they have been
idle counting." The student page listens for `visibilitychange` (another
tab), `blur` and `focus` (another window); `noteAway()` stamps `awaySince`
when the page goes out of sight, clears it when it comes back, and calls
`publishNow()` at once so the wall hears within a poll. `awaySince` rides
in the board message, the Firebase node and a new `boards.away_since`
column (paste **chalkline-06**). The tile gets `.away` (red border and
head, `--away`/`--away-soft` tokens in all three themes) and an *away 1m
12s* counter ticked every second by `tickAway`. Two limits told to Ryan:
the browser says the page is hidden or unfocused, not what the student
switched to; a second monitor or a dimmed phone reads as away. **The
Supabase write survives the paste not having happened**: PostgREST answers
PGRST204 for an unknown column, which would have failed the entire board
write and dropped the student from the wall — so the first refusal sets
`noAwayColumn` and the row is re-sent without it. `test-workspaces` covers
all of it through the real events (`document.hidden` redefined,
`hasFocus` stubbed) and `test-schema` writes and clears the column.

**v45 — the sign-in box is mounted, not a modal.** Ryan: the box vanished
on an outside click. `showSignInPanel()` calls `clerk.mountSignIn` into
`#clerkAuth` on the splash and adds one `clerk.addListener` (guarded by
`authListenerAdded`) that unmounts and runs `startAccounts()` once a user
appears. `authMounted`/`authListenerAdded` are hoisted. `test-boot`
asserts `#clerkAuth` exists.

**v44 — the looser timer rule, and the teacher's panel per workspace.**
Ryan settled the timer reading: students may type in *every* workspace at
all times; a timer goes on the last problem only; when it runs out
(`locked`) everything locks until the next problem arrives. `isFrozen()`
is now simply `return locked`; `markTimed()` still tags headings but
nothing reads the tag. `drawWorkPanel` groups the open board into one
`.wsgroup` per workspace (`.wsghead` label + mark button, `.wsgbody`),
numbers restarting per section. A real bug found there: the note tree was
linked once and cached, so `x^2` then `+7` in a feedback note landed inside
the exponent; every draw now relinks (`link(nt, null)`), proven with
`x^{2+7}` in the falsification run.

**v43 — "Structure", and a piecewise function.** The first palette section
is *Structure* (was Templates). Two new buttons, `pw2` and `pw3`, insert
`cases(2, 2)` / `cases(3, 2)` — the existing `cases` node, every cell an
empty `L()` list, so each piece gets an orange slot for its value and one
for its domain. The button faces are the same structure with `{}` cells
(`\begin{cases} {} & {} \\ … \end{cases}`); that parses with no warnings
and renders four/six slots. `test-workspaces` inserts both and counts the
`&` separators. The v40 timer-rule reading is parked by Ryan ("will come
back to that").

**v42 — the typing shortcuts.** Six rows, one line each at the panel's
width (`white-space:nowrap`, terse wording): shift + 4 · words ↔ maths;
enter · next line; / · fraction; ^ · exponent; _ · subscript; ← → · move
through your work. The "space finishes a \\command" row is gone — Ryan:
few students type LaTeX, and those who do will find it. `test-workspaces`
checks the order, the absence of the space row, and that every row is one
line tall.

**v41 — feedback under the last workspace; the panel's top; a real note bug.**
`#fbPanel` (general feedback, "From your teacher") moved *inside*
`.boardwrap`, above the 80vh of scroll room, so it sits right under the last
workspace instead of under a screen of air. The palette's sticky top block
is `prepend`ed and the palette has no top padding — its negative margin was
measured at +16px and simply not honoured, so nothing relies on it now.
Rail icons: 48px boxes, 12px faces (a fraction was 56px tall in a 44px box).
The first shortcut reads **shift + 4** — the key students press. And a real
fault found while testing the feedback position: `focusNote()` points the
caret into the note's tree, and closing the note (Escape, or Enter) only
dropped `gField` — every keystroke afterwards went into a note that no
longer existed, silently. `leaveNote()` puts the caret back on the line.
`test-workspaces` covers all four plus the note→feedback path (66 checks).

**v40 — click-back editing, governed by the timer.** Ryan: "click-back
editing is good if no timer was turned on." As built (`isFrozen`):
- **a timer is on** (the newest heading has `timed:true`): that workspace is
  the only open one; **time up** (`locked`) shuts everything until the next
  problem arrives (`setLocked` locks board and palette, as before v40);
- **no timer on**: a student may go back into any earlier workspace that was
  never timed; one that *was* timed stays shut for good.
A workspace learns it was timed from `markTimed()` in `startTimer` — on a
running timer, and on an expired one a late joiner receives — and carries
it in its heading string (`%%P {"label":…,"timed":true}`), so it survives
sync and reload. `isLocked()` now means "the caret's own workspace is
frozen"; `clearActive`, the backspace/ArrowUp guards and `removeLine` follow
the caret's section (`sectionOf`, `sectionEnd`, `lastPart`), not the last
one. The bright `.workspace.active` is the panel the caret is in; `.open`
panels are editable. **`let locked` is hoisted** with the other start-up
state: `isFrozen()` reads it inside the very first `render()` — the sixth
time the declaration trap has bitten, caught by `test-boot`. If Ryan wants
the looser reading (untimed panels open even while a timer runs), change
the `timerOn` branch only.

**v39 — the maths panel collapses to a rail; shortcuts and LaTeX moved.**
Two sizes, remembered per device in `localStorage` `chalkline.palette`
(`full` | `mini`; the old `hidden` reads as `mini`). `#paletteHide`
collapses, `#paletteExpand` (shown only in mini) expands; the top-bar
Hide/Show button is gone. **Mini** is `.wrap.mini` (64px column) with a rail
`#prail` of one `.prail-btn` per section — each icon is a clone of its
section's first button face. Clicking an icon calls `togglePop(si, btn)`,
which **borrows the section's real `.pgrid`** into the fixed `#ppop` beside
the icon (so every button keeps its listeners) and gives it back on close
(`closePop`: outside mousedown, Escape, same icon, or expanding).
`paletteGroups[si] = {title, group, grid}` is the map. The panel's top
(`.ptop`: collapse/expand + the typing shortcuts `#keys`) is `position:sticky`
inside the panel's own scroll; shortcuts show only in full. The LaTeX line
(`.inspector`) is a slim `position:fixed` footer — which took ~150px out of
the page's flow, so `.boardwrap` `padding-bottom` is 80vh now: the newest
panel is the end of the page and can only be scrolled as high as the page
is long. `test-workspaces` covers rail, pop-out, symbol insertion from the
pop-out, Escape, expand, sticky shortcuts and the footer.

**v38 — the strip is gone, notes sit under the line, the caret shows.**
The problem strip across the top (`#probStrip`) is `display:none` for good:
its body is still built because the push handler keys off `stripKey()`, but
nothing shows it, and the Hide/Show toggle and every `collapsed`/
`hideproblems`/`inpanels` reference are deleted. **The clock (`#probClock`)
moved into the student's top bar** — it lived in the strip head. The panel
header `.wshead` is a plain label (no border band — Ryan's "extra css
table"). Teacher notes render **under** the line: `.linebody` wraps and
`.wnote` is `flex:0 0 100%`. The teacher's caret in a note being typed was
hidden by `.worklines .cursor{display:none}`; `.worklines .wnote.here
.cursor` restores it. A collapse tab (`#paletteHide`) sits at the top of the
palette as well as `#paletteBtn` in the bar. `SupabaseSync` stamps
`joined_at` with the session's own start on every board write, so a row
left behind by an earlier visit cannot show a stale "joined". `openWorkspace`
calls `showStrip()` at once (the first push used to flash the strip before
the panel existed). The page needs `.boardwrap` `padding-bottom:55vh`: the
newest panel is the end of the page and can only reach the top if there is
room below it — a shorter page (the strip gone) exposed that. `test-phone`
now asserts the panel's problem is on screen; `test-push` no longer toggles
the strip.

**Lines wrap; nothing scrolls sideways (v37).** `.linebody` no longer
scrolls (the vertical-clipping side-effect its comment guarded against
vanishes once nothing clips); `.field` and **only the top-level** `.field >
.ml` may wrap — a fraction's numerator, a power, a matrix cell keep
`nowrap`. `.tx` text is `pre-wrap`. Also v37: the problem column is 39% of
its panel; a new panel gets a quiet outline (`wsfresh`), not the background
flash that read as "the screen flashed"; the palette is `position:sticky`
under the top bar and can be put away (`#paletteBtn`, `.wrap.nopalette`,
remembered in `localStorage` — the app's first use of it, try/catch
wrapped); a pushed problem scrolls the student to the **top of the new
panel** (`block:"start"`, `scroll-margin-top:110px`). Two consequences
worth knowing: the page needed room below the board (`.boardwrap`
`padding-bottom:40vh`) or the last panel could never reach the top — the
document simply ended; and the strip (count + clock) is now sticky too, or
that scroll carried the clock off a phone's screen (`test-phone` caught it).

**Workspace panels (v36).** `render()` is now `renderRows()` — one flat
`.line.brow` row per line, exactly as before — followed by `groupIntoPanels()`,
which folds the rows into one `<section class="workspace">` per heading:
`.wshead` (label + ✓), `.wslines` on the left, `.wsproblem` on the right
holding that workspace's own problem (`itemsForLabel` reads the number out
of the heading; `buildProblemItem` is the box builder shared with the strip).
The panel in use is `.active`; the rest are `.frozen` and dimmed as a whole
(per-line dimming is gone; per-line `pointer-events:none` stays). Line
numbers restart per panel (`sectionStart`). Labels are **Problem #N**. The
strip keeps only its count and clock (`.inpanels`); **Hide** now hides the
problems inside the panels (`.board.hideproblems`) and a new push shows
them again. Rows keep document order, so the index into `boardRows()` is the
index into `lines[]`. **Count `.brow`, never `.line`**: a problem rendered
inside a panel is made of `.line` rows too. `newItemIndices` treats
everything after the old list, when the old list is still the front of the
new one, as new — so the same sheet pushed twice opens a second workspace.
Ryan's "if a student switches to a different panel, dim it" was read as
"the panel they are moved *out of* dims" — old panels stay read-only.

**Headings render once (v35).** In `renderStatic` and `drawWorkPanel` the
*graph* branch appends its row and `return`s; the heading branch did not, so
it fell through into the maths renderer and typeset its own raw text —
`%%P{"label":…}` — under the label, and on the panel a heading picked up a
"+ note". Both branches are self-contained now. **Any new line kind added to
those two renderers must append its row and return.** `test-workspaces`
asserts a tile and the panel never contain `%%P`, and that a note still
opens on a work line of a board with headings.

**Problems sit side by side (v34).** `.probbody` is a horizontal flex row,
newest on the right, scrolling sideways when full; each `.probitem` is a
fixed-width column and images are capped at 200px tall. The v30 "scroll to
the new problem" uses `inline:"end"`. Reason: three stacked problems pushed
the board off the bottom of the screen. `test-workspaces` asserts the
second problem's box sits to the right of the first on the same row.

**A checkmark per workspace (v33).** `checks.marks` is `{"Problem 1": true,
…}` keyed by heading; `checked` stays as the whole-board tick for a board
with no headings. The big **Mark correct** button marks the workspace the
student is in now (`currentLabel`); every heading in the open panel has its
own `✓ mark` button (`setMark`); the tile shows *2/3 ✓* (`marksSummary`,
pure); the student sees a ✓ on each marked heading (`myMarks`). The
whole-board badge no longer lights for a board that has headings — the old
suites `test-class`/`test-persist` were updated to look at the heading.

**The Firebase path must carry marks too.** It stored a check as a bare
boolean; a per-workspace mark went in and *nothing* came out, silently, on
every suite that drives that path. A checks node is `{on, marks}` since v33
and `readCheck()` accepts either shape. Lesson: a feature that exists only
in one backend's shape is not a feature — every path that can carry the
message has to carry all of it.

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
3. ~~A test that drives `SupabaseSync`~~ — done in v48 (`test-supabase.js`).
   Worth extending as features land: every new column or message should get
   a check there, since the stand-in refuses unknown columns.
4. **Then graphing**, unchanged from before: a family picker first (every
   graph line is logarithmic), then linear and quadratic, then exponential.
   `FAMILIES` is a table; each entry declares its features and how to solve
   itself. Rational needs renderer work for poles. **Trig needs parameter
   inputs, not points.**
5. **The Firebase path can go** now that (3) exists — but the 11 older
   classroom suites still drive it, so retiring it means pointing them at
   the Supabase stand-in first. Not urgent; it costs nothing while it stays.

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
| `fake-supabase.js` | the stand-in Supabase: in-browser tables shared between pages, refuses unknown columns, no live updates |
| `fake-clerk.js` | the stand-in Clerk: who is signed in comes from the test |
| `test-supabase.js` | the only suite that runs the accounts + Supabase path end to end |
