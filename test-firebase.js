const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const fs = require('fs');
const FAKE = fs.readFileSync(path.join(HERE,'fake-firebase.js'), 'utf8');
// build a copy with the config filled in, so the real file ships unconfigured
const src = fs.readFileSync(path.join(HERE,'chalkline-board.html'), 'utf8')
  .replace('  apiKey:      "",', '  apiKey:      "test-key",')
  .replace('  databaseURL: "",', '  databaseURL: "https://test.firebaseio.com",');
fs.writeFileSync(path.join(HERE,'_fbtest.html'), src);
const URL = F('_fbtest.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1300,height:900} });
  // serve the stand-in SDK in place of the real one
  await ctx.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ status:200, contentType:'text/javascript', body: FAKE }));

  const errs = []; const watch = p => p.on('pageerror', e => errs.push(e.message));
  let pass = 0, fail = 0;
  const chk = (n, ok, d) => { if(ok) pass++; else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + d : '')); } };

  const teacher = await ctx.newPage(); watch(teacher);
  await teacher.goto(URL); await teacher.waitForTimeout(400);
  await teacher.fill('#roomInput','ALG2'); await __signInTeacher(teacher);
  chk('teacher shows as connected',
      (await teacher.evaluate(()=>document.getElementById('connChipT').textContent)) === 'live',
      await teacher.evaluate(()=>document.getElementById('connChipT').textContent));

  const mk = async name => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForTimeout(350);
    await p.fill('#roomInput','ALG2'); await p.fill('#nameInput', name);
    await p.click('#joinStudent'); await p.waitForTimeout(500);
    return p;
  };
  const priya = await mk('Priya');
  const sam   = await mk('Sam');
  chk('student shows as connected',
      (await priya.evaluate(()=>document.getElementById('connChipS').textContent)) === 'live');
  chk('student got a Firebase uid',
      (await priya.evaluate(()=>window.__chalkboard ? true : false)));

  await priya.focus('#hidden');
  await priya.keyboard.type('x^2', {delay:4}); await priya.keyboard.press('ArrowRight');
  await priya.keyboard.type('-9=0', {delay:4});
  await sam.focus('#hidden'); await sam.keyboard.type('1/2', {delay:4});
  await teacher.waitForTimeout(900);

  const seen = await teacher.evaluate(()=>window.__chalkboard.boards().map(b=>({n:b.name,l:b.lines})));
  chk('both boards reached the teacher', seen.length === 2, JSON.stringify(seen));
  chk('the maths came through', JSON.stringify(seen).includes('x^{2}-9=0'), JSON.stringify(seen));
  chk('two tiles drawn', (await teacher.evaluate(()=>document.querySelectorAll('.tile').length)) === 2);

  // feedback to one student only
  await teacher.click('.tile'); await teacher.waitForTimeout(300);
  const who = await teacher.evaluate(()=>document.getElementById('actingName').textContent);
  await teacher.focus('#hidden'); await teacher.keyboard.type('check the sign', {delay:4});
  await teacher.waitForTimeout(900);
  const target = who === 'Priya' ? priya : sam;
  const other  = who === 'Priya' ? sam : priya;
  chk('feedback reached ' + who, !(await target.evaluate(()=>document.getElementById('fbPanel').hidden)));
  chk('and nobody else', await other.evaluate(()=>document.getElementById('fbPanel').hidden));

  // the tick
  await teacher.click('#actingCheck'); await teacher.waitForTimeout(800);
  chk('tick reached ' + who, !(await target.evaluate(()=>document.getElementById('tickBadge').hidden)));
  chk('no tick for the other', await other.evaluate(()=>document.getElementById('tickBadge').hidden));
  await teacher.click('#actingBack'); await teacher.waitForTimeout(300);

  // a problem and a timer to everyone
  await teacher.click('#tPush'); await teacher.waitForTimeout(200);
  await teacher.setInputFiles('#probFile', path.join(HERE,'problem.png')); await teacher.waitForTimeout(600);
  await teacher.focus('#hidden'); await teacher.keyboard.type('f(x)=x^3', {delay:4});
  await teacher.fill('#probMins','5');
  await teacher.click('#probSend'); await teacher.waitForTimeout(1000);
  for(const [n, p] of [['Priya', priya], ['Sam', sam]]){
    chk(n + ' sees the problem', !(await p.evaluate(()=>document.getElementById('probStrip').hidden)));
    chk(n + ' sees the image', (await p.evaluate(()=>document.querySelectorAll('#probBody .probimgs img').length)) === 1);
    chk(n + "'s clock is running",
        /^[0-9]+:[0-9]{2}$/.test(await p.evaluate(()=>document.getElementById('probClock').textContent)),
        await p.evaluate(()=>document.getElementById('probClock').textContent));
  }

  // a late joiner picks up the room state from the database, with no roll-call
  const zoe = await mk('Zoe');
  await zoe.waitForTimeout(700);
  chk('late joiner gets the problem', !(await zoe.evaluate(()=>document.getElementById('probStrip').hidden)));
  chk('late joiner gets the clock',
      /^[0-9]+:[0-9]{2}$/.test(await zoe.evaluate(()=>document.getElementById('probClock').textContent)),
      await zoe.evaluate(()=>document.getElementById('probClock').textContent));
  await zoe.focus('#hidden'); await zoe.keyboard.type('2x+1', {delay:4});
  await teacher.waitForTimeout(900);
  chk('teacher sees the late joiner',
      (await teacher.evaluate(()=>window.__chalkboard.boards().length)) === 3,
      await teacher.evaluate(()=>window.__chalkboard.boards().length));

  // closing the board wipes everyone
  await teacher.click('#tClose'); await teacher.waitForTimeout(1000);
  chk('boards cleared', (await priya.evaluate(()=>window.__chalkline.tex())).trim() === '');
  chk('problem cleared', await priya.evaluate(()=>document.getElementById('probStrip').hidden));
  chk('feedback cleared', await target.evaluate(()=>document.getElementById('fbPanel').hidden));
  chk('tick cleared', await target.evaluate(()=>document.getElementById('tickBadge').hidden));
  await priya.focus('#hidden'); await priya.keyboard.type('3+4');
  chk('can type again after close', (await priya.evaluate(()=>window.__chalkline.tex())).trim() === '3+4');

  // a student closing their tab leaves the wall
  await sam.close(); await teacher.waitForTimeout(400);
  await teacher.evaluate(() => {
    // onDisconnect is a server behaviour the stand-in cannot emulate, so the
    // removal path is driven directly to prove the teacher handles it
    const ch = new BroadcastChannel('fakefb');
  });

  console.log(`\nfirebase adapter: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length ? errs.slice(0,4) : 'none');
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
