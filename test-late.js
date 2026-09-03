/* A student who joins after the problem and the timer should walk into both. */
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
fs.writeFileSync(path.join(HERE,'_late.html'), src);
const URL = F('_late.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1280,height:900} });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({status:200, contentType:'text/javascript', body:FAKE}));
  const errs=[]; const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;} else {fail++;console.log('FAIL  '+n+(d!==undefined?'  '+d:''));} };

  const teacher = await ctx.newPage(); watch(teacher);
  await teacher.goto(URL); await teacher.waitForTimeout(500);
  await teacher.fill('#roomInput','LATE');
  await teacher.click('#joinTeacher'); await teacher.waitForTimeout(250);
  await teacher.fill('#tEmail','mr@chalkline.test'); await teacher.fill('#tPass','correct-horse');
  await teacher.click('#tSignIn'); await teacher.waitForTimeout(800);

  /* two problems and a two-minute timer, with nobody in the room yet */
  for(const tex of ['x^2', 'y-1=0']){
    await teacher.click('#tPush'); await teacher.waitForTimeout(250);
    await teacher.focus('#hidden'); await teacher.keyboard.type(tex, {delay:4});
    if(tex === 'y-1=0') await teacher.fill('#probMins','2');
    await teacher.waitForTimeout(120);
    await teacher.click('#probSend'); await teacher.waitForTimeout(500);
  }

  /* let the clock run down a bit before anyone arrives */
  await teacher.waitForTimeout(4000);

  const kid = await ctx.newPage(); watch(kid);
  await kid.goto(URL); await kid.waitForTimeout(400);
  await kid.fill('#roomInput','LATE'); await kid.fill('#nameInput','Latecomer');
  await kid.click('#joinStudent'); await kid.waitForTimeout(1200);

  chk('the late student sees both problems',
      (await kid.evaluate(()=>document.querySelectorAll('#probBody .probitem').length)) === 2,
      await kid.evaluate(()=>document.querySelectorAll('#probBody .probitem').length));
  chk('the problem strip is open, not collapsed',
      !(await kid.evaluate(()=>document.getElementById('probStrip').hidden)) &&
      !(await kid.evaluate(()=>document.getElementById('probStrip').classList.contains('collapsed'))));

  const clock = await kid.evaluate(()=>{
    const c = document.getElementById('probClock');
    return {hidden:c.hidden, text:c.textContent};
  });
  console.log('  late joiner clock:', JSON.stringify(clock));
  chk('the countdown is running for them', !clock.hidden && /\d/.test(clock.text), JSON.stringify(clock));

  const secs = (() => {
    const m = /(\d+):(\d+)/.exec(clock.text);
    return m ? (+m[1])*60 + (+m[2]) : null;
  })();
  chk('and it shows the time actually left, not a fresh two minutes',
      secs !== null && secs < 120 && secs > 100, clock.text);

  /* the teacher and the latecomer agree on the remaining time */
  const tclock = await teacher.evaluate(()=>document.getElementById('tClock').textContent);
  console.log('  teacher clock:', tclock, ' student clock:', clock.text);
  const tsecs = (() => { const m=/(\d+):(\d+)/.exec(tclock); return m?(+m[1])*60+(+m[2]):null; })();
  chk('both devices agree on the countdown', tsecs !== null && Math.abs(tsecs - secs) <= 2,
      tclock + ' vs ' + clock.text);

  chk('the latecomer reaches the wall',
      (await teacher.evaluate(()=>window.__chalkboard.boards().length)) === 1);

  /* ---- a new timer on each push, and a way to stop one ---- */
  const clocks = async () => ({
    t: await teacher.evaluate(()=>{const c=document.getElementById('tClock');return c.hidden?'':c.textContent;}),
    s: await kid.evaluate(()=>{const c=document.getElementById('probClock');return c.hidden?'':c.textContent;})
  });
  const push2 = async (tex, mins) => {
    await teacher.click('#tPush'); await teacher.waitForTimeout(250);
    await teacher.focus('#hidden'); await teacher.keyboard.type(tex, {delay:4});
    if(mins != null) await teacher.fill('#probMins', String(mins));
    await teacher.waitForTimeout(120);
    await teacher.click('#probSend'); await teacher.waitForTimeout(700);
  };

  await push2('a=1', 3);
  let c = await clocks();
  chk('a new push can set a fresh countdown', c.t === '3:00' && c.s === '3:00', JSON.stringify(c));

  await teacher.waitForTimeout(2500);
  await push2('b=2', null);                       // minutes left blank
  c = await clocks();
  chk('a push with no time leaves the clock running', /^2:5/.test(c.s), JSON.stringify(c));
  chk('and both ends still agree', c.t === c.s, JSON.stringify(c));

  await push2('c=3', 5);
  c = await clocks();
  chk('a later push replaces the countdown', c.t === '5:00' && c.s === '5:00', JSON.stringify(c));

  /* the composer says what blank will do, and can stop the clock */
  await teacher.click('#tPush'); await teacher.waitForTimeout(400);
  const note = await teacher.evaluate(()=>document.getElementById('probTimerNote').textContent);
  chk('the composer says what blank means', /blank keeps the \d/.test(note), note);
  chk('a stop button is offered while one runs',
      !(await teacher.evaluate(()=>document.getElementById('probStopTimer').hidden)));
  await teacher.click('#probStopTimer'); await teacher.waitForTimeout(700);
  c = await clocks();
  chk('stopping the timer clears it everywhere', c.t === '' && c.s === '', JSON.stringify(c));
  chk('and the composer now says there is none',
      /blank means no timer/.test(await teacher.evaluate(()=>document.getElementById('probTimerNote').textContent)));
  await teacher.click('#probCancel'); await teacher.waitForTimeout(300);

  chk('nothing threw', errs.length === 0, errs.join(' | '));


  console.log(`\nlate joiner + timers: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
