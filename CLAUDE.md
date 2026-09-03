# Chalkline

A shared whiteboard for live online maths classes. Students type mathematics
that looks like mathematics; the teacher watches every board in real time,
pushes problems, writes feedback, and marks work correct.

Built for Ryan Markatos, who teaches Honors Algebra II & Trig and AP Calculus
over Zoom. The whole point is the equation editor: LaTeX is the right way to
write mathematics, but making students learn LaTeX is not an option.

Live at **https://chalklineschool.com/**

---

## The one rule

**`app.html` is the only file you edit.** Everything else is generated or
supporting. After any change:

```bash
python3 build.py       # writes chalkline-board.html and index.html
./run-tests.sh         # runs all 20 suites, prints one line each
```

`index.html` is what goes on GitHub Pages. `chalkline-board.html` is the same
app with no Firebase settings — the tests use it so they never touch the real
database.

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

`LocalSync` (BroadcastChannel, no account) is used when there are no Firebase
settings. `FirebaseSync` is the real one. Message types: `board`, `problem`,
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

- A **student id is `authUid + "-" + TAB_TAG`**, where `TAB_TAG` is minted
  fresh on every page load. Anonymous sign-in gives one identity per *browser*,
  not per tab, and remembers it between visits — so without this, two tabs on
  one machine are the same student, sharing a board and each other's feedback.
  Ryan wants every tab and every visit to be a student who has never been here
  before; nothing carries over.
- The rules therefore say `$id.beginsWith(auth.uid)`, not `===`.
- **A change here needs `firebase-rules.json` re-published by hand.** The app
  and the rules must ship together or students get `PERMISSION_DENIED`.

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

20 suites, ~500 assertions plus 500 generated round-trips.

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

**A test that cannot fail is not a test.** When you fix a bug, first make the
test fail against the old behaviour, then fix it. `test-tabs.js` passed *before*
the identity fix, because the stand-in gave every tab its own uid — the opposite
of the real SDK. The stand-in had to be corrected before the test meant
anything.

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
