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
  chk('a workspace opens for problem 1', L[2] === P('Problem #1') && L[3] === '', JSON.stringify(L));
  chk('the caret is in the new workspace', (await start(priya)) === 3 && (await focus(priya)) === 3,
      'start ' + (await start(priya)) + ' focus ' + (await focus(priya)));
  let S = await raw(sam);
  chk('the panel has its own collapse tab', await priya.evaluate(() => !!document.getElementById('paletteHide')));
  chk('the clock lives in the top bar now', await priya.evaluate(() => !!document.querySelector('#viewBoard .brand #probClock')));
  chk('there is no Hide/Show for problems any more', await priya.evaluate(() => !document.getElementById('probToggle')));
  chk('an empty board leaves no empty section behind',
      S.length === 2 && S[0] === P('Problem #1') && S[1] === '', JSON.stringify(S));

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
      L.length === 4 && L[3] === '' && L[2] === P('Problem #1'), JSON.stringify(L));
  await priya.keyboard.type('y=2');

  // ---- problem 2 ----------------------------------------------------------
  await push('x+2');
  L = await raw(priya);
  chk('problem 2 opens a second workspace',
      L[4] === P('Problem #2') && L[5] === '' && L[3] === 'y=2', JSON.stringify(L));
  await priya.focus('#hidden'); await priya.keyboard.type('z=3');
  L = await raw(priya);
  chk('typing goes to workspace 2', L[5] === 'z=3', JSON.stringify(L));
  // each workspace is a panel with its own problem on the right (v36)
  const panels = await priya.evaluate(() => Array.from(document.querySelectorAll('#viewBoard .workspace')).map(w => ({
    head: w.querySelector('.wshead').textContent.trim(), cls: w.className,
    problem: (w.querySelector('.wsproblem') || {}).textContent || '',
    firstNo: (w.querySelector('.brow:not(.part) .gutter b') || {}).textContent })));
  chk('one panel per workspace, headed Problem #N',
      panels.length === 3 && panels[1].head === 'Problem #1' && panels[2].head === 'Problem #2', JSON.stringify(panels.map(p => p.head)));
  chk('the panel in use is bright and the rest are dimmed',
      /active/.test(panels[2].cls) && /frozen/.test(panels[0].cls) && /frozen/.test(panels[1].cls), JSON.stringify(panels.map(p => p.cls)));
  chk('each panel shows its own problem on the right',
      /x\+?1|x.*1/.test(panels[1].problem) && /2/.test(panels[2].problem) && panels[0].problem === '', JSON.stringify(panels.map(p => p.problem.slice(0, 20))));
  chk('line numbers restart inside each panel', panels[2].firstNo === '1' && panels[1].firstNo === '1', JSON.stringify(panels.map(p => p.firstNo)));
  chk('the panel header is a plain label, not a boxed band',
      await priya.evaluate(() => getComputedStyle(document.querySelector('#viewBoard .workspace .wshead')).borderBottomWidth === '0px'));
  // the two problems sit side by side, newest on the right (v34)
  const boxes = await priya.evaluate(() => Array.from(document.querySelectorAll('#probBody .probitem'))
    .map(el => { const r = el.getBoundingClientRect(); return {left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width)}; }));
  chk('the strip still holds every problem (hidden, for the count and the clock)', boxes.length === 2, JSON.stringify(boxes));
  await teacher.waitForTimeout(900);
  const tile = await teacher.evaluate(() => {
    const t = document.querySelector('#tiles .tile');
    return t ? {head: (t.querySelector('.partlabel') || {}).textContent, text: t.textContent} : null;
  });
  chk('the wall tile shows the workspace in use', !!tile && tile.head === 'Problem #2' && /z/.test(tile.text), JSON.stringify(tile));
  chk('the tile never shows a heading\'s raw text', !!tile && !/%%P|label/.test(tile.text), JSON.stringify(tile));

  // ---- marking one workspace at a time ------------------------------------
  await teacher.click('#tiles .tile');                 // Priya sorts first
  await teacher.waitForTimeout(400);
  const btns = await teacher.evaluate(() => Array.from(document.querySelectorAll('#workLines .line.part .partmark-btn')).map(b => b.textContent));
  chk('the open panel has a mark button on every heading', btns.length === 3, JSON.stringify(btns));
  const panelRaw = await teacher.evaluate(() => document.getElementById('workLines').textContent);
  chk('the panel never shows a heading\'s raw text', !/%%P|label/.test(panelRaw), panelRaw.slice(0, 80));
  const noteBtns = await teacher.evaluate(() => ({ onHeadings: document.querySelectorAll('#workLines .wrow.part .wadd').length,
                                                   onLines: document.querySelectorAll('#workLines .wrow:not(.part) .wadd').length }));
  chk('note buttons sit on lines of work, not on headings', noteBtns.onHeadings === 0 && noteBtns.onLines >= 1, JSON.stringify(noteBtns));
  await teacher.evaluate(() => { const b = [...document.querySelectorAll('#workLines .wrow:not(.part) .wadd')].pop();
                                 b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true})); });
  await teacher.waitForTimeout(300);
  chk('a note can still be opened on a line of a board with headings',
      await teacher.evaluate(() => !!document.querySelector('#workLines .wnote.here')));
  chk('the teacher sees a caret in the note being typed',
      await teacher.evaluate(() => { const c = document.querySelector('#workLines .wnote.here .cursor'); return !!c && getComputedStyle(c).display !== 'none'; }));
  await teacher.focus('#hidden'); await teacher.keyboard.type('good', {delay:4}); await teacher.waitForTimeout(900);
  const noteRect = await priya.evaluate(() => {
    const n = document.querySelector('#viewBoard .wnote.mine'); if(!n) return null;
    const f = n.closest('.linebody').querySelector('.field');
    const a = f.getBoundingClientRect(), b = n.getBoundingClientRect();
    return {fieldBottom: Math.round(a.bottom), noteTop: Math.round(b.top), noteLeft: Math.round(b.left), fieldLeft: Math.round(a.left)};
  });
  chk('the student sees the note under the line, not beside it',
      !!noteRect && noteRect.noteTop >= noteRect.fieldBottom - 2, JSON.stringify(noteRect));
  await teacher.keyboard.press('Escape'); await teacher.waitForTimeout(200);
  await teacher.evaluate(() => document.querySelectorAll('#workLines .line.part .partmark-btn')[1].click());   // Problem 1
  await teacher.waitForTimeout(700);
  let marks = await priya.evaluate(() => window.__chalkline.marks());
  chk('the student receives the mark for Problem 1', marks['Problem #1'] === true && !marks['Problem #2'], JSON.stringify(marks));
  const ticks = await priya.evaluate(() => Array.from(document.querySelectorAll('#viewBoard .line.part')).map(r => r.textContent.includes('\u2713')));
  chk('the tick sits on the Problem 1 heading only', JSON.stringify(ticks) === '[false,true,false]', JSON.stringify(ticks));
  const big = await teacher.evaluate(() => document.getElementById('actingCheck').textContent);
  chk('the big button now marks the current workspace', /Problem #2/.test(big), big);
  await teacher.click('#actingCheck'); await teacher.waitForTimeout(700);
  marks = await priya.evaluate(() => window.__chalkline.marks());
  chk('Mark correct marked Problem 2', marks['Problem #2'] === true && marks['Problem #1'] === true, JSON.stringify(marks));
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

  // ---- v37: narrower problem column, wrapping lines, sticky palette, toggle ----
  const cols = await priya.evaluate(() => {
    const b = document.querySelector('#viewBoard .workspace.active .wsbody');
    const px = getComputedStyle(b).gridTemplateColumns.split(' ').map(parseFloat);
    return {ratio: px[1] / (px[0] + px[1]), cols: px.length};
  });
  chk('the problem column is about 39% of the panel', cols.cols === 2 && Math.abs(cols.ratio - 0.39) < 0.03, JSON.stringify(cols));
  await priya.focus('#hidden'); await priya.keyboard.type('a+'.repeat(60) + 'a', {delay:1});
  await priya.waitForTimeout(200);
  const wrapInfo = await priya.evaluate(() => {
    const rows = document.querySelectorAll('#viewBoard .workspace.active .brow:not(.part)');
    const row = rows[rows.length - 1];
    const body = row.querySelector('.linebody'), field = row.querySelector('.field');
    return {bodyScroll: body.scrollWidth, bodyClient: body.clientWidth, fieldH: field.getBoundingClientRect().height};
  });
  chk('a long line never scrolls sideways', wrapInfo.bodyScroll <= wrapInfo.bodyClient + 1, JSON.stringify(wrapInfo));
  chk('a long line wraps onto more lines', wrapInfo.fieldH > 55, JSON.stringify(wrapInfo));
  chk('the button panel is sticky', await priya.evaluate(() => getComputedStyle(document.getElementById('palette')).position === 'sticky'));
  chk('there is no Hide/Show maths in the top bar', await priya.evaluate(() => !document.getElementById('paletteBtn')));
  chk('the typing shortcuts live in the panel and stay put',
      await priya.evaluate(() => { const k = document.querySelector('#palette #keys'); return !!k && getComputedStyle(k.closest('.ptop')).position === 'sticky'; }));
  await priya.click('#paletteHide'); await priya.waitForTimeout(150);
  const mini = await priya.evaluate(() => ({ cls: document.querySelector('#viewBoard .wrap').className,
    width: Math.round(document.getElementById('palette').getBoundingClientRect().width),
    icons: document.querySelectorAll('#prail .prail-btn').length,
    keys: getComputedStyle(document.getElementById('keys')).display,
    saved: (() => { try { return localStorage.getItem('chalkline.palette'); } catch (e) { return null; } })() }));
  chk('Collapse turns the panel into a rail of one icon per section',
      /mini/.test(mini.cls) && mini.width < 100 && mini.icons === 6 && mini.keys === 'none' && mini.saved === 'mini', JSON.stringify(mini));
  await priya.evaluate(() => document.querySelector('#prail .prail-btn').dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true})));
  await priya.waitForTimeout(150);
  const pop = await priya.evaluate(() => { const p = document.getElementById('ppop'); const r = p.getBoundingClientRect();
    const rail = document.querySelector('#prail .prail-btn').getBoundingClientRect();
    return {hidden: p.hidden, btns: p.querySelectorAll('.pbtn').length, title: p.querySelector('.lbl').textContent, besideRail: r.left > rail.right}; });
  chk('a rail icon opens a pop-out beside it with the section\'s symbols',
      !pop.hidden && pop.btns > 0 && pop.title === 'Templates' && pop.besideRail, JSON.stringify(pop));
  const before = await priya.evaluate(() => window.__chalkline.tex());
  await priya.evaluate(() => { const b = document.querySelector('#ppop .pbtn'); if(b) b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true})); });
  await priya.waitForTimeout(150);
  chk('a symbol from the pop-out lands on the line',
      (await priya.evaluate(() => window.__chalkline.tex())) !== before && /frac/.test(await priya.evaluate(() => window.__chalkline.tex())));
  await priya.keyboard.press('Escape'); await priya.waitForTimeout(100);
  chk('Escape closes the pop-out and returns the symbols to their section',
      await priya.evaluate(() => document.getElementById('ppop').hidden && document.querySelectorAll('#palette .pgroup .pgrid').length === 6));
  await priya.click('#paletteExpand'); await priya.waitForTimeout(150);
  chk('Expand brings the full panel back',
      await priya.evaluate(() => !/mini/.test(document.querySelector('#viewBoard .wrap').className) && getComputedStyle(document.getElementById('keys')).display !== 'none'));
  const foot = await priya.evaluate(() => { const el = document.querySelector('.inspector'); const cs = getComputedStyle(el); return {pos: cs.position, h: Math.round(el.getBoundingClientRect().height), bottom: Math.round(window.innerHeight - el.getBoundingClientRect().bottom)}; });
  chk('the LaTeX line is a slim fixed footer', foot.pos === 'fixed' && foot.h < 70 && foot.bottom === 0, JSON.stringify(foot));
  const glow = await priya.evaluate(() => { for (const ss of document.styleSheets) { try { for (const r of ss.cssRules) if (r.selectorText === '.workspace.fresh') return r.style.animationName; } catch (e) {} } return null; });
  chk('a new panel gets a quiet outline, not a background flash', glow === 'wsfresh', JSON.stringify(glow));

  // ---- the same sheet pushed again is still a new problem (prefix rule) ----
  // first make the board tall, so the new panel would start below the fold
  await priya.focus('#hidden'); for(let i = 0; i < 30; i++) await priya.keyboard.press('Enter');
  await priya.evaluate(() => window.scrollTo(0, 0)); await priya.waitForTimeout(100);
  await push('x+2');
  L = await raw(priya);
  chk('pushing the same problem again opens another workspace', L[L.length - 2] === P('Problem #3') && L[L.length - 1] === '', JSON.stringify(L.slice(-2)));
  await priya.waitForTimeout(900);                       // the smooth scroll
  const view = await priya.evaluate(() => { const w = document.querySelector('#viewBoard .workspace.active');
    const r = w.getBoundingClientRect(); return {top: Math.round(r.top), vh: window.innerHeight}; });
  chk('the student is scrolled to the newest problem', view.top >= 0 && view.top < 200, JSON.stringify(view));

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
