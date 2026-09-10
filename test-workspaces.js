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

  // ---- an untimed workspace stays open: the student may go back into it ---
  await priya.keyboard.press('Home'); await priya.keyboard.press('ArrowUp');
  chk('up from the first line of a workspace stays put', (await focus(priya)) === 3, 'focus ' + (await focus(priya)));
  await priya.evaluate(() => window.__chalkline.focusTo(1));   // back into Earlier work
  await priya.keyboard.type('9');
  L = await raw(priya);
  chk('an untimed earlier workspace can still be written in', L[1] === 'a=19', JSON.stringify(L));
  await priya.keyboard.press('Backspace');
  L = await raw(priya);
  chk('and erased', L[1] === 'a=1', JSON.stringify(L));
  chk('no workspace is dimmed when none was timed',
      0 === await priya.evaluate(() => document.querySelectorAll('#viewBoard .workspace.frozen').length));
  await priya.evaluate(() => window.__chalkline.focusTo(3));
  await priya.keyboard.press('End');
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
  chk('the panel the caret is in is bright; untimed ones stay open',
      /active/.test(panels[2].cls) && /open/.test(panels[0].cls) && /open/.test(panels[1].cls) && !/frozen/.test(panels[0].cls + panels[1].cls), JSON.stringify(panels.map(p => p.cls)));
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
    return t ? {heads: Array.from(t.querySelectorAll('.partlabel')).map(h => h.textContent),
                nums: Array.from(t.querySelectorAll('.gutter b')).map(b => b.textContent).filter(Boolean),
                text: t.textContent} : null;
  });
  // v46 — Ryan: "I am only seeing the work they have typed into the latest question"
  chk('the wall tile shows every workspace, not just the one in use',
      !!tile && tile.heads.join('|') === 'Earlier work|Problem #1|Problem #2' && /z/.test(tile.text) && /a=1|a.*1/.test(tile.text),
      JSON.stringify(tile));
  chk('tile line numbers restart under each heading', !!tile && tile.nums[0] === '1' && tile.nums.filter(n => n === '1').length === 3,
      JSON.stringify(tile && tile.nums));
  chk('the tile never shows a heading\'s raw text', !!tile && !/%%P|label/.test(tile.text), JSON.stringify(tile));

  // ---- marking one workspace at a time ------------------------------------
  await teacher.click('#tiles .tile');                 // Priya sorts first
  await teacher.waitForTimeout(400);
  const btns = await teacher.evaluate(() => Array.from(document.querySelectorAll('#workLines .wsghead .partmark-btn')).map(b => b.textContent));
  chk('the open panel has a mark button on every heading', btns.length === 3, JSON.stringify(btns));
  // v44: the teacher's opened board is one panel per workspace
  const groups = await teacher.evaluate(() => Array.from(document.querySelectorAll('#workLines .wsgroup')).map(g => ({
    head: (g.querySelector('.wsghead span') || {}).textContent || null, rows: g.querySelectorAll('.wrow').length })));
  chk('each workspace is its own panel with a header',
      groups.length >= 3 && groups.some(g => g.head === 'Problem #1') && groups.some(g => g.head === 'Problem #2'), JSON.stringify(groups));
  const panelRaw = await teacher.evaluate(() => document.getElementById('workLines').textContent);
  chk('the panel never shows a heading\'s raw text', !/%%P|label/.test(panelRaw), panelRaw.slice(0, 80));
  const noteBtns = await teacher.evaluate(() => ({ onHeadings: document.querySelectorAll('#workLines .wsghead .wadd').length,
                                                   onLines: document.querySelectorAll('#workLines .wrow .wadd').length }));
  chk('note buttons sit on lines of work, not on headings', noteBtns.onHeadings === 0 && noteBtns.onLines >= 1, JSON.stringify(noteBtns));
  await teacher.evaluate(() => { const b = [...document.querySelectorAll('#workLines .wrow .wadd')].pop();
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
  // v44: typing x^2 in a note then ArrowRight must leave the exponent, so the
  // rest of the note lands on the line, not up in the superscript
  await teacher.evaluate(() => { const bb=[...document.querySelectorAll('#workLines .wrow .wadd')][0]; bb.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); });
  await teacher.waitForTimeout(200);
  await teacher.focus('#hidden');
  await teacher.keyboard.type('x'); await teacher.keyboard.press('Shift+Digit6'); await teacher.keyboard.type('2');
  await teacher.keyboard.press('ArrowRight'); await teacher.keyboard.type('+7');
  await teacher.keyboard.press('Enter'); await teacher.waitForTimeout(300);
  const noteVals = await teacher.evaluate(() => Object.values(window.__chalkline.notes()));
  chk('a note lets you leave the exponent (x^2 then +7 lands on the line)',
      noteVals.some(v => /x\^\{2\}\s*\+\s*7/.test(v)) && !noteVals.some(v => /x\^\{2\s*\+\s*7\}/.test(v)), JSON.stringify(noteVals));
  // general feedback (the panel's own lines, not a note) sits right under the last workspace
  await teacher.focus('#hidden'); await teacher.keyboard.type('nice work', {delay:4}); await teacher.waitForTimeout(900);
  const fbPos = await priya.evaluate(() => {
    const fb = document.getElementById('fbPanel'); const ws = document.querySelectorAll('#viewBoard .workspace');
    const last = ws[ws.length - 1]; if(!fb || fb.hidden || !last) return {hidden: !fb || fb.hidden};
    return {hidden: false, gap: Math.round(fb.getBoundingClientRect().top - last.getBoundingClientRect().bottom)};
  });
  chk('general feedback appears right under the last workspace', !fbPos.hidden && fbPos.gap >= -2 && fbPos.gap < 120, JSON.stringify(fbPos));
  await teacher.evaluate(() => document.querySelectorAll('#workLines .wsghead .partmark-btn')[1].click());   // Problem 1
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
  chk('clear board clears only the workspace the caret is in',
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
  chk('the shortcut block is flush with the top of the panel',
      await priya.evaluate(() => { const pal = document.getElementById('palette'), t = pal.querySelector('.ptop');
        return Math.abs(t.getBoundingClientRect().top - pal.getBoundingClientRect().top) <= 1; }));
  chk('the first shortcut names the key students press',
      await priya.evaluate(() => /shift/i.test(document.querySelector('#keys kbd').textContent)));
  const keys = await priya.evaluate(() => Array.from(document.querySelectorAll('#keys>div')).map(d => ({
    key: d.querySelector('kbd').textContent.trim(), h: Math.round(d.getBoundingClientRect().height) })));
  chk('the second shortcut is enter, and there is no space row',
      keys.length === 6 && keys[1].key === 'enter' && !keys.some(k => /space/i.test(k.key)), JSON.stringify(keys));
  chk('every shortcut fits on one line', keys.every(k => k.h < 26), JSON.stringify(keys));
  chk('the typing shortcuts live in the panel and stay put',
      await priya.evaluate(() => { const k = document.querySelector('#palette #keys'); return !!k && getComputedStyle(k.closest('.ptop')).position === 'sticky'; }));
  await priya.click('#paletteHide'); await priya.waitForTimeout(150);
  const mini = await priya.evaluate(() => ({ cls: document.querySelector('#viewBoard .wrap').className,
    width: Math.round(document.getElementById('palette').getBoundingClientRect().width),
    icons: document.querySelectorAll('#prail .prail-btn').length,
    keys: getComputedStyle(document.getElementById('keys')).display,
    saved: (() => { try { return localStorage.getItem('chalkline.palette'); } catch (e) { return null; } })() }));
  // piecewise: two or three pieces, every cell an empty slot (v43)
  const before2 = await priya.evaluate(() => window.__chalkline.tex());
  await priya.evaluate(() => { const b = document.querySelector('.pbtn[data-id="pw2"]'); if(b) b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true})); });
  await priya.waitForTimeout(120);
  const pw2 = await priya.evaluate(() => window.__chalkline.tex());
  chk('the 2-piece button inserts a piecewise function with two rows',
      pw2 !== before2 && /\\begin\{cases\}/.test(pw2) && (pw2.match(/&/g) || []).length === 2, pw2.slice(-80));
  await priya.evaluate(() => { const b = document.querySelector('.pbtn[data-id="pw3"]'); if(b) b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true})); });
  await priya.waitForTimeout(120);
  const pw3 = await priya.evaluate(() => window.__chalkline.tex());
  chk('the 3-piece button inserts three rows', (pw3.match(/&/g) || []).length === 5, pw3.slice(-100));
  chk('the pieces are empty slots for the student to fill',
      await priya.evaluate(() => document.querySelectorAll('#viewBoard .workspace.active .brow.focus .slot, #viewBoard .brow.focus .empty, #viewBoard .brow.focus .ph').length >= 4));
  chk('every rail icon fits inside its button',
      await priya.evaluate(() => Array.from(document.querySelectorAll('#prail .prail-btn')).every(btn => {
        const b = btn.getBoundingClientRect(), f = btn.querySelector('.face').getBoundingClientRect();
        return f.height <= b.height + 1 && f.width <= b.width + 1; })));
  chk('Collapse turns the panel into a rail of one icon per section',
      /mini/.test(mini.cls) && mini.width < 100 && mini.icons === 6 && mini.keys === 'none' && mini.saved === 'mini', JSON.stringify(mini));
  await priya.evaluate(() => document.querySelector('#prail .prail-btn').dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true})));
  await priya.waitForTimeout(150);
  const pop = await priya.evaluate(() => { const p = document.getElementById('ppop'); const r = p.getBoundingClientRect();
    const rail = document.querySelector('#prail .prail-btn').getBoundingClientRect();
    return {hidden: p.hidden, btns: p.querySelectorAll('.pbtn').length, title: p.querySelector('.lbl').textContent, besideRail: r.left > rail.right}; });
  chk('a rail icon opens a pop-out beside it with the section\'s symbols',
      !pop.hidden && pop.btns > 0 && pop.title === 'Structure' && pop.besideRail, JSON.stringify(pop));
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

  // ---- timers and click-back (v40) -----------------------------------------
  // Ryan (v44): students may type in every workspace at all times; a timer
  // goes only on the last problem, and when it expires EVERYTHING locks.
  await priya.evaluate(() => window.__chalkline.timer(30, 777000));   // a running timer on the newest problem
  await priya.waitForTimeout(150);
  chk('a running timer freezes no workspace',
      0 === await priya.evaluate(() => document.querySelectorAll('#viewBoard .workspace.frozen').length));
  await priya.evaluate(() => window.__chalkline.focusTo(3));   // an earlier problem, while the timer runs
  await priya.keyboard.type('!');
  L = await raw(priya);
  chk('an earlier workspace can still be written in while a timer runs', /!/.test(L[3]), JSON.stringify(L[3]));
  // time runs out: pencils down everywhere. Expiry comes from the clock
  // ticking, never a second message about a timer already heard.
  await priya.evaluate(() => window.__chalkline.timer(1, 888000));
  await priya.waitForTimeout(1900);
  chk('time up shows the lock bar', await priya.evaluate(() => !document.getElementById('lockBar').hidden));
  chk('time up freezes every workspace',
      await priya.evaluate(() => { const ws = [...document.querySelectorAll('#viewBoard .workspace')];
        return ws.length > 0 && ws.every(w => w.classList.contains('frozen')); }));
  await priya.evaluate(() => window.__chalkline.focusTo(3));
  await priya.keyboard.type('?');
  L = await raw(priya);
  chk('no workspace can be written in once time is up', !/\?/.test(L[3]), JSON.stringify(L[3]));
  await push('x+5');                                             // the next problem lifts the lock
  await priya.waitForTimeout(200);
  await priya.evaluate(() => window.__chalkline.focusTo(3));
  await priya.keyboard.type('?');
  L = await raw(priya);
  chk('a new problem lifts the lock everywhere', /\?/.test(L[3]), JSON.stringify(L[3]));

  // ---- away (v46) -----------------------------------------------------------
  // Ryan: "If the student leaves the screen I want their panel highlighted
  // red ... I also want the time they have been idle counting."
  if(await teacher.evaluate(() => { const b = document.getElementById('actingBack'); return !!b && b.offsetParent !== null; })){
    await teacher.click('#actingBack'); await teacher.waitForTimeout(400);
  }
  const tileState = () => teacher.evaluate(() => {
    const t = document.querySelector('#tiles .tile');
    return t ? {away: t.classList.contains('away'), text: (t.querySelector('.tilehead .away') || {}).textContent || ''} : null;
  });
  let ts = await tileState();
  chk('a tile starts out not away', !!ts && !ts.away && ts.text === '', JSON.stringify(ts));
  // the real path: the page is hidden behind another tab
  await priya.evaluate(() => {
    Object.defineProperty(document, 'hidden', {get: () => true, configurable: true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await teacher.waitForTimeout(600);
  chk('a hidden page counts as away', await priya.evaluate(() => window.__chalkline.away() !== null));
  ts = await tileState();
  chk('the tile goes red when the student leaves the screen', !!ts && ts.away, JSON.stringify(ts));
  chk('the tile shows how long they have been away', !!ts && /^away \d+s$/.test(ts.text), JSON.stringify(ts));
  await teacher.waitForTimeout(2200);
  const ts2 = await tileState();
  chk('the away time counts up', !!ts2 && ts2.text !== ts.text && /^away \d+s$/.test(ts2.text), JSON.stringify([ts, ts2]));
  await priya.evaluate(() => {
    Object.defineProperty(document, 'hidden', {get: () => false, configurable: true});
    document.hasFocus = () => true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await teacher.waitForTimeout(600);
  ts = await tileState();
  chk('coming back clears the red', !!ts && !ts.away && ts.text === '', JSON.stringify(ts));
  // losing the window (clicking outside it) is the same signal
  await priya.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
  await teacher.waitForTimeout(600);
  ts = await tileState();
  chk('clicking outside the window counts as away too', !!ts && ts.away, JSON.stringify(ts));
  await priya.evaluate(() => { document.hasFocus = () => true; window.dispatchEvent(new Event('focus')); });
  await teacher.waitForTimeout(600);
  ts = await tileState();
  chk('focus back clears it', !!ts && !ts.away, JSON.stringify(ts));
  chk('away text: seconds then minutes', await priya.evaluate(() => window.__chalkline.awayText(45000) === 'away 45s' && window.__chalkline.awayText(192000) === 'away 3m 12s'));

  // ---- "a newer version is out" (v48) ----------------------------------------
  const mine = await priya.evaluate(() => window.__chalkline.version());
  chk('the page knows its own version', /^v\d+$/.test(mine), mine);
  const bump = n => '<p><span class="ver">v' + n + '</span></p>';
  const shown = html => priya.evaluate(h => { window.__chalkline.liveVersion(h); return !document.getElementById('verBar').hidden; }, html);
  chk('a newer version on the site raises the notice', await shown(bump(+mine.slice(1) + 1)));
  chk('the notice offers a Reload button', await priya.evaluate(() => { const b = document.getElementById('verReload'); return !!b && /reload/i.test(b.textContent); }));
  chk('the same version raises nothing', !(await shown(bump(+mine.slice(1)))));
  chk('an OLDER copy served by a cache raises nothing either', !(await shown(bump(+mine.slice(1) - 1))));
  chk('a page with no chip raises nothing', !(await shown('<p>not chalkline</p>')));

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
