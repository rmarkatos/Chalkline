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
./run-tests.sh         # runs all 23 suites, prints one line each
```

`index.html` is what goes on GitHub Pages. `chalkline-board.html` is the same
app with **no settings at all** — no Firebase, no Supabase, no Clerk. The tests
drive it, so they never touch the real database or a real account.

There is a version chip on screen (`v26`, next to the class code). **Bump it in
`app.html` whenever you ship**, or nobody can tell which build they are looking
at. Several hours were lost to exactly that.

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
**This has caused a blank page four separate times.** If the page loads to
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

23 suites, ~570 assertions plus 500 generated round-trips.

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
- **A student who reloads mid-lesson** becomes a new student. Their old tile
  lingers up to 30s until the presence sweep. That is the chosen cost of "every
  visit is a first visit".

---

## Where it stands

**Equation editor.** Typing, raw LaTeX, inline text (`$` toggles mid-line),
fractions, radicals, scripts, big operators, matrices, cases. Palette panels:
Templates, Operators, Number sets and symbols, Calculus, Trigonometry,
Exponents & logs. Brackets are typed as characters and only pair with their own
partner, so `[)` stays as typed. The space bar inserts a space everywhere
except straight after a `\command` and at the end of a script, where LaTeX
itself spends it.

**Classroom.** Teacher sign-in (email/password, rules check
`auth.token.email`), the wall, push a problem (PNG or PDF, several stack up), a
timer that locks input, feedback, per-line notes, a checkmark.

**Graphing.** Students state *key features* — asymptote, intercepts, base — and
the curve is drawn from them; the equation appears only when they ask for it,
so it confirms their algebra. One family so far: **logarithmic**.

### Next

1. **More families.** `FAMILIES` is a table; each entry declares the features it
   needs and how to solve itself. Linear, quadratic, exponential and
   polynomial-from-roots are each a short solve. Rational needs renderer work
   for poles. **Trig needs parameter inputs, not points** — points do not
   determine a periodic function.
2. **A family picker.** Every graph line is logarithmic right now.
3. **Zoom and pan** on a graph; the window is computed from the features.
4. `board.html` and `chalkline-equation-editor.html` are dead — the editor
   suites test the real app now. They are not in this folder.

---

## Files

| File | |
| --- | --- |
| `app.html` | the source — the only file you edit |
| `build.py` | writes both builds |
| `firebase-config.json` | the Firebase settings, injected at build time |
| `index.html` | built + configured — this is what goes on GitHub Pages |
| `chalkline-board.html` | built, unconfigured — what the tests drive |
| `firebase-rules.json` | paste into Firebase → Realtime Database → Rules → Publish |
| `diagnose.html` | a page that checks the Firebase setup step by step and says where it stops |
| `run-tests.sh` | all suites, one line each |
| `test*.js` | the suites |
| `fake-firebase*.js` | the stand-in database, with and without rules enforcement |
