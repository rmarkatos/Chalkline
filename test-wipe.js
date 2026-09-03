/* Nothing about a lesson is meant to outlive it. */
const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const fs = require('fs');
const FAKE = fs.readFileSync(path.join(HERE,'fake-firebase-rules.js'), 'utf8');
const src = fs.readFileSync(path.join(HERE,'chalkline-board.html'), 'utf8')
  .replace('  apiKey:      "",', '  apiKey:      "test-key",')
  .replace('  databaseURL: "",', '  databaseURL: "https://test.firebaseio.com",');
fs.writeFileSync(path.join(HERE,'_wipe.html'), src);
const URL = F('_wipe.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1280,height:900} });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({status:200, contentType:'text/javascript', body:FAKE}));
  const errs=[]; const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;} else {fail++;console.log('FAIL  '+n+(d!==undefined?'  '+d:''));} };

  const teacher = async room => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForTimeout(500);
    await p.fill('#roomInput', room);
    await p.click('#joinTeacher'); await p.waitForTimeout(250);
    const needs = await p.evaluate(()=>!document.getElementById('signinBox').hidden);
    if(needs){
      await p.fill('#tEmail','mr@chalkline.test'); await p.fill('#tPass','correct-horse');
      await p.click('#tSignIn');
    }
    await p.waitForTimeout(800);
    return p;
  };
  const student = async (room, name) => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForTimeout(400);
    await p.fill('#roomInput', room); await p.fill('#nameInput', name);
    await p.click('#joinStudent'); await p.waitForTimeout(600);
    return p;
  };
  const lesson = async (t, kids) => {
    for(const [p, tex] of kids){
      await p.focus('#hidden'); await p.keyboard.type(tex, {delay:4});
    }
    await t.waitForTimeout(900);
    await t.click('#tPush'); await t.waitForTimeout(250);
    await t.focus('#hidden'); await t.keyboard.type('f(x)=x^3', {delay:4});
    await t.fill('#probMins','5'); await t.click('#probSend'); await t.waitForTimeout(600);
    await t.click('.tile'); await t.waitForTimeout(350);
    await t.focus('#hidden'); await t.keyboard.type('nice', {delay:4});
    await t.click('#actingCheck'); await t.waitForTimeout(600);
    await t.click('#actingBack'); await t.waitForTimeout(300);
  };
  const store = p => p.evaluate(() => JSON.stringify(globalThis.__fakeStore || {}));
  const roomEmpty = async (p, room) => {
    const v = JSON.parse(await store(p));
    const r = (v.rooms || {})[room];
    if(!r) return true;
    // the stand-in leaves empty containers where the real database removes them
    return Object.keys(r).every(k => {
      const c = r[k];
      return c === null || (typeof c === 'object' && Object.keys(c).length === 0);
    });
  };

  /* ---- 1. a lesson leaves plenty behind, until it is ended ---- */
  const t = await teacher('WIPE');
  const priya = await student('WIPE','Priya');
  const sam   = await student('WIPE','Sam');
  await lesson(t, [[priya,'x^2'], [sam,'1/2']]);

  let v = JSON.parse(await store(t));
  chk('a lesson has work, feedback, a check, a problem and a timer',
      JSON.stringify(v).includes('x^{2}') && JSON.stringify(v).includes('nice') &&
      JSON.stringify(v).includes('items') && JSON.stringify(v).includes('endsAt'));

  /* ---- 2. one click on sign out changes nothing ---- */
  const before = await store(t);
  await t.click('#tSignOut'); await t.waitForTimeout(400);
  chk('one click on sign out erases nothing',
      !(await roomEmpty(t, 'WIPE')));
  chk('and the button says what the next click will do',
      /erase/i.test(await t.evaluate(()=>document.getElementById('tSignOut').textContent)),
      await t.evaluate(()=>document.getElementById('tSignOut').textContent));

  /* ---- 3. the second click erases the lot ---- */
  await t.click('#tSignOut'); await t.waitForTimeout(2200);
  chk('confirming sign out empties the room', await roomEmpty(t, 'WIPE'), await store(t));
  chk('the students are sent back to the join screen',
      (await priya.evaluate(()=>!document.getElementById('viewLanding').hidden)) &&
      (await sam.evaluate(()=>!document.getElementById('viewLanding').hidden)));
  chk('the teacher is signed out',
      await t.evaluate(()=>!document.getElementById('viewLanding').hidden));

  /* ---- 4. and it stays empty past the students' heartbeat ---- */
  await t.waitForTimeout(9000);
  chk('nothing creeps back once the class has gone', await roomEmpty(t, 'WIPE'), await store(t));

  /* ---- 5. signing in again starts on a clean board ---- */
  const t2 = await teacher('WIPE');
  chk('a new session starts with an empty wall',
      (await t2.evaluate(()=>window.__chalkboard.boards().length)) === 0);
  chk('and no problem left over',
      (await t2.evaluate(()=>window.__chalkboard.problems().length)) === 0);

  /* ---- 6. every class code opened this session is erased, not just one ---- */
  await t2.click('#tLeave'); await t2.waitForTimeout(400);
  await t2.fill('#roomInput','SECOND');
  await t2.click('#joinTeacher'); await t2.waitForTimeout(800);
  const kid2 = await student('SECOND','Ada');
  await kid2.focus('#hidden'); await kid2.keyboard.type('y=mx+b', {delay:4});
  await t2.waitForTimeout(900);
  chk('the second class has work in it', !(await roomEmpty(t2,'SECOND')), await store(t2));
  await t2.click('#tSignOut'); await t2.waitForTimeout(300);
  await t2.click('#tSignOut'); await t2.waitForTimeout(2200);
  chk('signing out erases the second class too', await roomEmpty(t2,'SECOND'), await store(t2));
  chk('and the first one is still gone', await roomEmpty(t2,'WIPE'));

  /* ---- 7. closing the tab is covered as well ---- */
  const t3 = await teacher('CRASH');
  const kid3 = await student('CRASH','Bo');
  await kid3.focus('#hidden'); await kid3.keyboard.type('2x=8', {delay:4});
  await t3.waitForTimeout(900);
  const armed = await t3.evaluate(() => (globalThis.__fakeOnDisconnect || []).slice());
  chk('the teacher arms a cleanup for the whole room if the tab dies',
      armed.includes('rooms/CRASH'), JSON.stringify(armed));
  const fired = await t3.evaluate(() => globalThis.__fireDisconnect('rooms/CRASH'));
  await t3.waitForTimeout(300);
  chk('and firing it empties the room', fired && (await roomEmpty(t3,'CRASH')), await store(t3));

  /* ---- 8. a room that was ended does not throw the next class out ----
     The end signal used to sit in the database for good, so anyone joining
     later read it as an instruction and was bounced straight back out. */
  const t4 = await teacher('AGAIN');
  const kid4 = await student('AGAIN','Cleo');
  await kid4.focus('#hidden'); await kid4.keyboard.type('x=1', {delay:4});
  await t4.waitForTimeout(900);
  await t4.click('#tSignOut'); await t4.waitForTimeout(300);
  await t4.click('#tSignOut'); await t4.waitForTimeout(2200);
  chk('the class is sent back to the join screen',
      await kid4.evaluate(()=>!document.getElementById('viewLanding').hidden));

  // leave the end signal behind, the way a failed erase would
  await t4.evaluate(()=>globalThis.__fakeWrite('rooms/AGAIN/closed', -Date.now()));
  await t4.waitForTimeout(200);

  const kid5 = await student('AGAIN','Dev');
  await kid5.waitForTimeout(1500);
  chk('a student joining afterwards is not thrown out',
      await kid5.evaluate(()=>!document.getElementById('viewBoard').hidden),
      await kid5.evaluate(()=>document.getElementById('viewLanding').hidden ? 'on the board' : 'kicked to landing'));
  await kid5.focus('#hidden'); await kid5.keyboard.type('y=2', {delay:4});
  await kid5.waitForTimeout(600);
  chk('and can work normally',
      (await kid5.evaluate(()=>window.__chalkline.tex())).includes('y=2'),
      await kid5.evaluate(()=>window.__chalkline.tex()));

  /* ---- 9. signing out stops the page asking for things it may not have ---- */
  const t6 = await teacher('QUIET');
  await student('QUIET','Eve');
  await t6.waitForTimeout(900);
  await t6.evaluate(()=>{ const b=document.getElementById('errBar');
                          b.hidden = true; document.getElementById('errList').textContent=''; });
  await t6.click('#tSignOut'); await t6.waitForTimeout(300);
  await t6.click('#tSignOut'); await t6.waitForTimeout(2500);
  chk('signing out leaves no permission errors behind',
      await t6.evaluate(()=>document.getElementById('errBar').hidden),
      await t6.evaluate(()=>document.getElementById('errList').innerText));

  chk('nothing threw', errs.length === 0, errs.join(' | '));
  console.log(`\nnothing is kept: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
