/* One workspace per pushed problem.

   Ryan's rule: each problem the teacher pushes opens a fresh work area on
   the student's board; everything above it stays on screen but freezes.
   A heading is a "%%P {...}" line — a string, like a graph line — so the
   sharing layer, the database and the wall need no change to carry it.

   Two students, one teacher, all in one browser over LocalSync. Priya has
   written something before the first problem; Sam has not.               */
const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const URL = 'file://' + path.join(HERE, 'chalkline-board.html');
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1280,height:900} });
  const errs = []; const watch = p => p.on('pageerror', e => errs.push(e.message));
  let pass = 0, fail = 0;
  const chk = (n, ok, d) => { if(ok) pass++; else { fail++; console.log('FAIL ' + n + (d ? '  ' + d : '')); } };

  const teacher = await ctx.newPage(); watch(teacher);
  await teacher.goto(URL); await teacher.waitForTimeout(300);
  await teacher.fill('#roomInput','ALG2'); await signIn(teacher);
  const mk = async name => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForTimeout(250);
    await p.fill('#roomInput','ALG2'); await p.fill('#nameInput', name);
    await p.click('#joinStudent'); await p.waitForTimeout(250);
    return p;
  };
  const priya = await mk('Priya');
  const sam   = await mk('Sam');
  const raw   = p => p.evaluate(() => window.__chalkline.linesRaw());
  const start = p => p.evaluate(() => window.__chalkline.activeStart());
  const focus = p => p.evaluate(() => window.__chalkline.state().focus);
  const push = async (tex) => {
    await teacher.click('#tPush'); await teacher.waitForTimeout(200);
    await teacher.focus('#hidden'); await teacher.keyboard.type(tex, {delay:4});
    await teacher.click('#probSend'); await teacher.waitForTimeout(900);
  };
  const P = label => '%%P ' + JSON.stringify({label});

  await priya.focus('#hidden'); await priya.keyboard.type('a=1');
  await teacher.waitForTimeout(400);

  // ---- problem 1 ----------------------------------------------------------
  await push('x+1');
  let L = await raw(priya);
  chk('earlier work is kept under its own heading',
      L[0] === P('Earlier work') && L[1] === 'a=1', JSON.stringify(L));
  chk('a workspace opens for problem 1', L[2] === P('Problem 1') && L[3] === '', JSON.stringify(L));
  chk('the caret is in the new workspace', (await start(priya)) === 3 && (await focus(priya)) === 3,
      'start ' + (await start(priya)) + ' focus ' + (await focus(priya)));
  let S = await raw(sam);
  chk('an empty board leaves no empty section behind',
      S.length === 2 && S[0] === P('Problem 1') && S[1] === '', JSON.stringify(S));

  await priya.focus('#hidden'); await priya.keyboard.type('y=2');
  L = await raw(priya);
  chk('typing lands in the new workspace', L[3] === 'y=2' && L[1] === 'a=1', JSON.stringify(L));

  // ---- the frozen section cannot be reached or changed ---------------------
  await priya.keyboard.press('Home'); await priya.keyboard.press('ArrowUp');
  chk('up from the first line of a workspace stays put', (await focus(priya)) === 3, 'focus ' + (await focus(priya)));
  await priya.evaluate(() => window.__chalkline.focusTo(1));   // force it, as a test
  await priya.keyboard.type('9');
  L = await raw(priya);
  chk('a frozen line cannot be typed into', L[1] === 'a=1', JSON.stringify(L));
  await priya.keyboard.press('Backspace');
  L = await raw(priya);
  chk('a frozen line cannot be erased', L[1] === 'a=1', JSON.stringify(L));
  await priya.evaluate(() => window.__chalkline.focusTo(3));
  await priya.keyboard.press('End');            // backspace deletes to the LEFT
  for(let i = 0; i < 4; i++) await priya.keyboard.press('Backspace');
  L = await raw(priya);
  chk('backspace empties the workspace but keeps its first line',
      L.length === 4 && L[3] === '' && L[2] === P('Problem 1'), JSON.stringify(L));
  await priya.keyboard.type('y=2');

  // ---- problem 2 ----------------------------------------------------------
  await push('x+2');
  L = await raw(priya);
  chk('problem 2 opens a second workspace',
      L[4] === P('Problem 2') && L[5] === '' && L[3] === 'y=2', JSON.stringify(L));
  await priya.focus('#hidden'); await priya.keyboard.type('z=3');
  L = await raw(priya);
  chk('typing goes to workspace 2', L[5] === 'z=3', JSON.stringify(L));
  // the two problems sit side by side, newest on the right (v34)
  const boxes = await priya.evaluate(() => Array.from(document.querySelectorAll('#probBody .probitem'))
    .map(el => { const r = el.getBoundingClientRect(); return {left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width)}; }));
  chk('two problems are shown', boxes.length === 2, JSON.stringify(boxes));
  chk('problems sit side by side, newest on the right',
      boxes.length === 2 && boxes[1].left > boxes[0].left + boxes[0].w - 1 && Math.abs(boxes[1].top - boxes[0].top) < 2,
      JSON.stringify(boxes));
  await teacher.waitForTimeout(900);
  const tile = await teacher.evaluate(() => {
    const t = document.querySelector('#tiles .tile');
    return t ? {head: (t.querySelector('.partlabel') || {}).textContent, text: t.textContent} : null;
  });
  chk('the wall tile shows the workspace in use', !!tile && tile.head === 'Problem 2' && /z/.test(tile.text), JSON.stringify(tile));

  // ---- marking one workspace at a time ------------------------------------
  await teacher.click('#tiles .tile');                 // Priya sorts first
  await teacher.waitForTimeout(400);
  const btns = await teacher.evaluate(() => Array.from(document.querySelectorAll('#workLines .line.part .partmark-btn')).map(b => b.textContent));
  chk('the open panel has a mark button on every heading', btns.length === 3, JSON.stringify(btns));
  await teacher.evaluate(() => document.querySelectorAll('#workLines .line.part .partmark-btn')[1].click());   // Problem 1
  await teacher.waitForTimeout(700);
  let marks = await priya.evaluate(() => window.__chalkline.marks());
  chk('the student receives the mark for Problem 1', marks['Problem 1'] === true && !marks['Problem 2'], JSON.stringify(marks));
  const ticks = await priya.evaluate(() => Array.from(document.querySelectorAll('#viewBoard .line.part')).map(r => r.textContent.includes('\u2713')));
  chk('the tick sits on the Problem 1 heading only', JSON.stringify(ticks) === '[false,true,false]', JSON.stringify(ticks));
  const big = await teacher.evaluate(() => document.getElementById('actingCheck').textContent);
  chk('the big button now marks the current workspace', /Problem 2/.test(big), big);
  await teacher.click('#actingCheck'); await teacher.waitForTimeout(700);
  marks = await priya.evaluate(() => window.__chalkline.marks());
  chk('Mark correct marked Problem 2', marks['Problem 2'] === true && marks['Problem 1'] === true, JSON.stringify(marks));
  await teacher.click('#actingBack'); await teacher.waitForTimeout(500);
  const badge = await teacher.evaluate(() => { const k = document.querySelector('#tiles .tile .ticked'); return k ? k.textContent : null; });
  chk('the tile counts marked workspaces', badge === '2/3 ✓', JSON.stringify(badge));

  // ---- clear board clears only the workspace in use -------------------------
  await priya.click('#clearAll');
  L = await raw(priya);
  chk('clear board keeps the frozen workspaces',
      L.length === 6 && L[3] === 'y=2' && L[5] === '', JSON.stringify(L));

  // ---- headings survive a round trip, and are not maths ---------------------
  await priya.evaluate(() => window.__chalkline.loadRaw(window.__chalkline.linesRaw()));
  chk('headings round-trip through save and load', JSON.stringify(await raw(priya)) === JSON.stringify(L));
  chk('tex() reads only the maths', !/%%P/.test(await priya.evaluate(() => window.__chalkline.tex())));

  console.log(`\nworkspaces: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
  if(fail || errs.length) process.exit(1);
})();

async function signIn(p){
  await p.click('#joinTeacher'); await p.waitForTimeout(250);
  const needs = await p.evaluate(() => { const b = document.getElementById('signinBox'); return !!b && !b.hidden; });
  if(needs){ await p.fill('#tEmail','mr@chalkline.test'); await p.fill('#tPass','correct-horse'); await p.click('#tSignIn'); }
  await p.waitForTimeout(500);
}
