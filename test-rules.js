/* The whole app, run against a database that enforces the published rules.
   The point of this suite: if any page subscribes to something the rules
   refuse, its error banner appears — so "no banner anywhere" is the check. */
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
fs.writeFileSync(path.join(HERE,'_rules.html'), src);
const URL = F('_rules.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1280,height:900} });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({status:200, contentType:'text/javascript', body:FAKE}));
  const errs=[]; const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;} else {fail++;console.log('FAIL  '+n+(d!==undefined?'  '+d:''));} };
  const banner = p => p.evaluate(()=>{
    const e=document.getElementById('errBar');
    return e.hidden ? "" : document.getElementById('errList').innerText;
  });

  const teacher = await ctx.newPage(); watch(teacher);
  await teacher.goto(URL); await teacher.waitForTimeout(500);
  await teacher.fill('#roomInput','ALG2');
  await teacher.click('#joinTeacher'); await teacher.waitForTimeout(250);
  await teacher.fill('#tEmail','mr@chalkline.test'); await teacher.fill('#tPass','correct-horse');
  await teacher.click('#tSignIn'); await teacher.waitForTimeout(800);
  chk('the teacher is on the wall',
      await teacher.evaluate(()=>!document.getElementById('viewTeacher').hidden));

  const mk = async name => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForTimeout(400);
    await p.fill('#roomInput','ALG2'); await p.fill('#nameInput', name);
    await p.click('#joinStudent'); await p.waitForTimeout(600);
    return p;
  };
  const priya = await mk('Priya');
  const sam   = await mk('Sam');

  await priya.focus('#hidden'); await priya.keyboard.type('x^2', {delay:4});
  await priya.keyboard.press('ArrowRight'); await priya.keyboard.type('-9=0', {delay:4});
  await sam.focus('#hidden'); await sam.keyboard.type('1/2', {delay:4});
  await teacher.waitForTimeout(1000);

  const seen = await teacher.evaluate(()=>window.__chalkboard.boards().map(x=>({n:x.name,l:x.lines})));
  chk('both students reach the wall', seen.length === 2, JSON.stringify(seen));
  chk('their maths comes through', JSON.stringify(seen).includes('x^{2}-9=0'), JSON.stringify(seen));

  /* feedback and a checkmark, to one student */
  await teacher.click('.tile'); await teacher.waitForTimeout(400);
  const who = await teacher.evaluate(()=>document.getElementById('actingName').textContent);
  await teacher.focus('#hidden'); await teacher.keyboard.type('watch the sign', {delay:4});
  await teacher.click('#actingCheck'); await teacher.waitForTimeout(900);
  const target = who === 'Priya' ? priya : sam;
  const other  = who === 'Priya' ? sam : priya;
  chk('the right student gets the feedback',
      (await target.evaluate(()=>document.getElementById('fbLines').innerText)).includes('watch'));
  chk('the other student does not',
      await other.evaluate(()=>document.getElementById('fbPanel').hidden));
  chk('the right student gets the checkmark',
      !(await target.evaluate(()=>document.getElementById('tickBadge').hidden)));

  /* two problems */
  await teacher.click('#actingBack'); await teacher.waitForTimeout(300);
  for(const tex of ['x+1=5','y-2=7']){
    await teacher.click('#tPush'); await teacher.waitForTimeout(250);
    await teacher.focus('#hidden'); await teacher.keyboard.type(tex, {delay:4});
    await teacher.waitForTimeout(120);
    await teacher.click('#probSend'); await teacher.waitForTimeout(600);
  }
  chk('both problems reach a student',
      (await priya.evaluate(()=>document.querySelectorAll('#probBody .probitem').length)) === 2,
      await priya.evaluate(()=>document.querySelectorAll('#probBody .probitem').length));

  /* the rules refused nothing anyone asked for */
  for(const [n,p] of [['teacher',teacher],['Priya',priya],['Sam',sam]]){
    const msg = await banner(p);
    chk('nothing was refused on the ' + n + ' page', msg === '', msg);
  }

  chk('nothing threw', errs.length === 0, errs.join(' | '));
  console.log(`\nunder the real rules: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
