/* Who can open the teacher view, and what the page does when they cannot. */
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
fs.writeFileSync(path.join(HERE,'_auth.html'), src);
const URL = F('_auth.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1280,height:900} });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({status:200, contentType:'text/javascript', body:FAKE}));
  const errs=[]; const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;} else {fail++;console.log('FAIL  '+n+(d!==undefined?'  '+d:''));} };
  const shown = (p,id) => p.evaluate(i=>{const e=document.getElementById(i); return !!e && !e.hidden;}, id);

  /* ---- a plain visitor is asked to sign in ---- */
  const nosy = await ctx.newPage(); watch(nosy);
  await nosy.goto(URL); await nosy.waitForTimeout(600);
  await nosy.click('#joinTeacher'); await nosy.waitForTimeout(300);
  chk('the teacher view asks for a sign-in', await shown(nosy,'signinBox'));
  chk('and does not open the wall', !(await shown(nosy,'viewTeacher')));

  /* ---- a wrong password gets a sentence, not a code ---- */
  await nosy.fill('#tEmail','mr@chalkline.test'); await nosy.fill('#tPass','guess');
  await nosy.click('#tSignIn'); await nosy.waitForTimeout(400);
  const msg = await nosy.evaluate(()=>document.getElementById('signMsg').textContent);
  chk('a wrong password is explained in English',
      /do not match/.test(msg) && !/auth\//.test(msg), msg);
  chk('still no wall', !(await shown(nosy,'viewTeacher')));

  /* ---- an unknown address is refused too ---- */
  await nosy.fill('#tEmail','student@chalkline.test'); await nosy.fill('#tPass','correct-horse');
  await nosy.click('#tSignIn'); await nosy.waitForTimeout(400);
  chk('an unknown address is refused', !(await shown(nosy,'viewTeacher')));

  /* ---- editing the address bar to role=teacher does not walk in ---- */
  const url = await ctx.newPage(); watch(url);
  await url.goto(URL + '#room=ALG2&role=teacher'); await url.waitForTimeout(800);
  chk('role=teacher in the address bar still asks to sign in', await shown(url,'signinBox'));
  chk('role=teacher in the address bar opens no wall', !(await shown(url,'viewTeacher')));
  chk('and it remembered which class was asked for',
      (await url.evaluate(()=>document.getElementById('roomInput').value)) === 'ALG2');

  /* ---- a student never subscribes to the wall ---- */
  const kid = await ctx.newPage(); watch(kid);
  await kid.goto(URL + '#room=ALG2&role=student'); await kid.waitForTimeout(600);
  chk('the student link puts the teacher button away', !(await shown(kid,'joinTeacher')));
  await kid.fill('#nameInput','Priya'); await kid.click('#joinStudent'); await kid.waitForTimeout(700);
  chk('the student is on their own board', await shown(kid,'viewBoard'));
  chk('the student holds no other board',
      (await kid.evaluate(()=>window.__chalkboard.boards().length)) === 0);

  /* ---- the right credentials do open it ---- */
  const teacher = await ctx.newPage(); watch(teacher);
  await teacher.goto(URL); await teacher.waitForTimeout(600);
  await teacher.fill('#roomInput','ALG2');
  await teacher.click('#joinTeacher'); await teacher.waitForTimeout(250);
  await teacher.fill('#tEmail','mr@chalkline.test'); await teacher.fill('#tPass','correct-horse');
  await teacher.click('#tSignIn'); await teacher.waitForTimeout(800);
  chk('the right credentials open the wall', await shown(teacher,'viewTeacher'));
  chk('and the class is there',
      (await teacher.evaluate(()=>window.__chalkboard.boards().length)) === 1,
      await teacher.evaluate(()=>window.__chalkboard.boards().length));
  chk('connected', (await teacher.evaluate(()=>document.getElementById('connChipT').textContent)) === 'live');

  /* ---- signing out closes it again (and takes two clicks) ---- */
  await teacher.click('#tSignOut'); await teacher.waitForTimeout(300);
  chk('one click only arms it', await shown(teacher,'viewTeacher'));
  await teacher.click('#tSignOut'); await teacher.waitForTimeout(1800);
  chk('signing out returns to the landing page', await shown(teacher,'viewLanding'));
  chk('signing out closes the wall', !(await shown(teacher,'viewTeacher')));
  await teacher.click('#joinTeacher'); await teacher.waitForTimeout(300);
  chk('and the password is wanted again', await shown(teacher,'signinBox'));

  chk('nothing threw', errs.length === 0, errs.join(' | '));
  console.log(`\nteacher access: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
