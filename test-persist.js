/* Problems stack up; feedback and checkmarks outlive the teacher's page. */
const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const fs = require('fs');
const FAKE = fs.readFileSync(path.join(HERE,'fake-firebase.js'), 'utf8');
const src = fs.readFileSync(path.join(HERE,'chalkline-board.html'), 'utf8')
  .replace('  apiKey:      "",', '  apiKey:      "test-key",')
  .replace('  databaseURL: "",', '  databaseURL: "https://test.firebaseio.com",');
fs.writeFileSync(path.join(HERE,'_persist.html'), src);
const URL = F('_persist.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1300,height:900} });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({status:200, contentType:'text/javascript', body:FAKE}));
  const errs=[]; const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;} else {fail++;console.log('FAIL  '+n+(d!==undefined?'  '+d:''));} };

  const openTeacher = async () => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForTimeout(350);
    await p.fill('#roomInput','ALG2'); await __signInTeacher(p);
    return p;
  };
  const push = async (t, tex) => {
    await t.click('#tPush'); await t.waitForTimeout(250);
    await t.focus('#hidden'); await t.keyboard.type(tex, {delay:4});
    await t.waitForTimeout(120);
    await t.click('#probSend'); await t.waitForTimeout(500);
  };

  let teacher = await openTeacher();
  const priya = await ctx.newPage(); watch(priya);
  await priya.goto(URL); await priya.waitForTimeout(350);
  await priya.fill('#roomInput','ALG2'); await priya.fill('#nameInput','Priya');
  await priya.click('#joinStudent'); await priya.waitForTimeout(500);

  /* ---- 1. problems stack ---- */
  await push(teacher, 'x+1=5');
  await priya.waitForTimeout(400);
  chk('first problem arrives',
      (await priya.evaluate(()=>document.querySelectorAll('#probBody .probitem').length)) === 1);

  await push(teacher, 'y-2=7');
  await priya.waitForTimeout(400);
  const items = await priya.evaluate(()=>[...document.querySelectorAll('#probBody .probitem')].map(e=>e.innerText.replace(/\s+/g,'')));
  chk('a second problem joins the first, in order', items.length === 2, JSON.stringify(items));
  chk('both problems are readable',
      items[0].includes('x+1=5') && items[1].includes('y\u22122=7'), JSON.stringify(items));
  chk('the strip counts them',
      (await priya.evaluate(()=>document.getElementById('plabel').textContent)) === '2 problems');

  await push(teacher, 'z=9');
  await priya.waitForTimeout(400);
  chk('a third stacks too',
      (await priya.evaluate(()=>document.querySelectorAll('#probBody .probitem').length)) === 3);

  /* ---- 2. feedback survives leaving the panel ---- */
  await teacher.click('.tile'); await teacher.waitForTimeout(350);
  await teacher.focus('#hidden'); await teacher.keyboard.type('check the sign', {delay:4});
  await teacher.click('#actingCheck'); await teacher.waitForTimeout(600);
  chk('the student sees the feedback',
      (await priya.evaluate(()=>document.getElementById('fbLines').innerText)).includes('check'),
      await priya.evaluate(()=>document.getElementById('fbPanel').hidden));
  chk('the student sees the checkmark',
      !(await priya.evaluate(()=>document.getElementById('tickBadge').hidden)));

  await teacher.click('#actingBack'); await teacher.waitForTimeout(400);
  await teacher.click('.tile'); await teacher.waitForTimeout(500);
  chk('reopening the panel shows the feedback again',
      (await teacher.evaluate(()=>window.__chalkline.tex())).includes('check~the~sign'),
      await teacher.evaluate(()=>window.__chalkline.tex()));
  chk('the checkmark is still on in the panel',
      await teacher.evaluate(()=>document.getElementById('actingCheck').classList.contains('checked')));
  await teacher.waitForTimeout(600);
  chk('and the student still has it',
      (await priya.evaluate(()=>document.getElementById('fbLines').innerText)).includes('check'),
      await priya.evaluate(()=>document.getElementById('fbLines').innerText));

  /* ---- 3. a brand new teacher page picks up what is already there ---- */
  await teacher.click('#actingBack'); await teacher.waitForTimeout(200);
  await teacher.close();
  const teacher2 = await openTeacher();
  await teacher2.waitForTimeout(900);
  chk('a fresh teacher page sees the problems already up',
      (await teacher2.evaluate(()=>window.__chalkboard.problems().length)) === 3,
      await teacher2.evaluate(()=>window.__chalkboard.problems().length));
  await teacher2.click('.tile'); await teacher2.waitForTimeout(500);
  chk('a fresh teacher page loads the existing feedback',
      (await teacher2.evaluate(()=>window.__chalkline.tex())).includes('check~the~sign'),
      await teacher2.evaluate(()=>window.__chalkline.tex()));
  chk('and the existing checkmark',
      await teacher2.evaluate(()=>document.getElementById('actingCheck').classList.contains('checked')));
  await teacher2.waitForTimeout(700);
  chk('opening the panel did not wipe the student',
      (await priya.evaluate(()=>document.getElementById('fbLines').innerText)).includes('check'),
      await priya.evaluate(()=>document.getElementById('fbLines').innerText));

  /* ---- 4. clearing ---- */
  await teacher2.click('#actingBack'); await teacher2.waitForTimeout(250);
  await teacher2.click('#tPush'); await teacher2.waitForTimeout(250);
  await teacher2.click('#probClear'); await teacher2.waitForTimeout(500);
  chk('clear all removes every problem',
      (await priya.evaluate(()=>document.querySelectorAll('#probBody .probitem').length)) === 0,
      await priya.evaluate(()=>document.getElementById('probBody').innerText));

  console.log(`\npersistence: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();

/* The teacher signs in before the wall will open. With no Firebase config the
   page runs in local-only mode and walks straight in, so handle both. */
async function __signInTeacher(p){
  await p.click('#joinTeacher');
  await p.waitForTimeout(250);
  const needs = await p.evaluate(() => {
    const b = document.getElementById('signinBox');
    return !!b && !b.hidden;
  });
  if(needs){
    await p.fill('#tEmail', 'mr@chalkline.test');
    await p.fill('#tPass',  'correct-horse');
    await p.click('#tSignIn');
  }
  await p.waitForTimeout(500);
}
