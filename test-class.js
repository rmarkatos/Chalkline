const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const URL = F('chalkline-board.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1280,height:900} });
  const errs = []; const watch = p => p.on('pageerror', e => errs.push(e.message));
  let pass = 0, fail = 0;
  const chk = (n, ok, d) => { if(ok) pass++; else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + d : '')); } };

  const teacher = await ctx.newPage(); watch(teacher);
  await teacher.goto(URL); await teacher.waitForTimeout(300);
  await teacher.fill('#roomInput','ALG2'); await __signInTeacher(teacher);

  const mk = async name => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForTimeout(250);
    await p.fill('#roomInput','ALG2'); await p.fill('#nameInput', name);
    await p.click('#joinStudent'); await p.waitForTimeout(250);
    return p;
  };
  const priya = await mk('Priya');
  const sam   = await mk('Sam');
  await priya.focus('#hidden'); await priya.keyboard.type('x^2', {delay:4});
  await priya.keyboard.press('ArrowRight'); await priya.keyboard.type('-9=0', {delay:4});
  await sam.focus('#hidden'); await sam.keyboard.type('1/2', {delay:4});
  await teacher.waitForTimeout(600);

  // --- 5. a pushed problem stays out of the student's own work -------------
  await teacher.click('#tPush'); await teacher.waitForTimeout(150);
  await teacher.setInputFiles('#probFile', path.join(HERE,'problem.png'));
  await teacher.waitForTimeout(500);
  await teacher.focus('#hidden'); await teacher.keyboard.type('f(x)=x^3', {delay:4});
  await teacher.click('#probSend'); await teacher.waitForTimeout(700);

  chk('problem shows in the strip', await priya.evaluate(()=>!document.getElementById('probStrip').hidden));
  chk('problem maths in the strip', (await priya.evaluate(()=>document.getElementById('probBody').innerText)).includes('f'));
  chk("student's own work untouched", (await priya.evaluate(()=>window.__chalkline.tex())).trim() === 'x^{2}-9=0',
      await priya.evaluate(()=>window.__chalkline.tex()));
  chk('image also in the strip', (await priya.evaluate(()=>document.querySelectorAll('#probBody .probimgs img').length)) === 1);

  // --- 2. feedback, with the full editor, kept apart from their work -------
  await teacher.click('.tile'); await teacher.waitForTimeout(250);
  chk('their work is shown to the teacher',
      (await teacher.evaluate(()=>document.getElementById('workLines').innerText)).includes('9'),
      await teacher.evaluate(()=>document.getElementById('workLines').innerText));
  await teacher.focus('#hidden');
  await teacher.keyboard.type('$check the sign of $x=-3', {delay:4});
  await priya.waitForTimeout(700);
  chk('feedback reaches the student', await priya.evaluate(()=>!document.getElementById('fbPanel').hidden));
  chk('feedback text is right',
      (await priya.evaluate(()=>document.getElementById('fbLines').innerText)).includes('check the sign'),
      await priya.evaluate(()=>document.getElementById('fbLines').innerText));
  chk('feedback did not touch their work',
      (await priya.evaluate(()=>window.__chalkline.tex())).trim() === 'x^{2}-9=0',
      await priya.evaluate(()=>window.__chalkline.tex()));
  chk('Sam got no feedback', await sam.evaluate(()=>document.getElementById('fbPanel').hidden));

  // --- 3. the tick ---------------------------------------------------------
  await teacher.click('#actingCheck'); await priya.waitForTimeout(500);
  chk('tick pops up for the student', await priya.evaluate(()=>!document.getElementById('tickBadge').hidden));
  chk('Sam has no tick', await sam.evaluate(()=>document.getElementById('tickBadge').hidden));
  await teacher.click('#actingBack'); await teacher.waitForTimeout(200);
  chk('tick shows on the tile', (await teacher.evaluate(()=>document.querySelector('.tile').innerText)).includes('✓'));

  // --- 1. the clock runs out: nothing more can be added -------------------
  await teacher.click('#tPush'); await teacher.waitForTimeout(150);
  await teacher.fill('#probMins','0.05'); await teacher.click('#probSend');
  await sam.waitForTimeout(4500);
  chk('lock banner shown', await sam.evaluate(()=>!document.getElementById('lockBar').hidden));
  const before = (await sam.evaluate(()=>window.__chalkline.tex())).trim();
  await sam.focus('#hidden'); await sam.keyboard.type('+99');
  chk('typing is blocked', (await sam.evaluate(()=>window.__chalkline.tex())).trim() === before,
      await sam.evaluate(()=>window.__chalkline.tex()));
  await sam.click('.pbtn[data-id="frac"]').catch(()=>{});
  chk('palette is blocked', (await sam.evaluate(()=>window.__chalkline.tex())).trim() === before);
  chk('their work is still on screen', before.length > 0, before);

  // --- 1b. and it stays until the teacher closes the board -----------------
  await teacher.click('#tClose'); await sam.waitForTimeout(600);
  chk('board cleared on close', (await sam.evaluate(()=>window.__chalkline.tex())).trim() === '');
  chk('unlocked on close', await sam.evaluate(()=>document.getElementById('lockBar').hidden));
  chk('problem cleared on close', await sam.evaluate(()=>document.getElementById('probStrip').hidden));
  await sam.focus('#hidden'); await sam.keyboard.type('2+2');
  chk('typing works again', (await sam.evaluate(()=>window.__chalkline.tex())).trim() === '2+2');

  // --- 4. the student link cannot join as a teacher ------------------------
  const link = await teacher.evaluate(()=>document.getElementById('tLink').value);
  chk('link is a student link', link.includes('role=student'), link);
  const guest = await ctx.newPage(); watch(guest);
  await guest.goto(URL + '#room=ALG2&role=student'); await guest.waitForTimeout(400);
  chk('teacher button hidden on the student link',
      await guest.evaluate(()=>document.getElementById('joinTeacher').hidden));
  chk('class code locked', await guest.evaluate(()=>document.getElementById('roomInput').readOnly));
  await guest.fill('#nameInput','Zoe'); await guest.click('#joinStudent'); await guest.waitForTimeout(300);
  chk('joins as a student', await guest.evaluate(()=>!document.getElementById('leaveBtn').hidden));

  console.log(`\nclassroom: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length ? errs : 'none');
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
