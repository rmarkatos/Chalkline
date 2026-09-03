/* Does the student view actually work on a phone? */
const { chromium, devices } = require('playwright');
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
fs.writeFileSync(path.join(HERE,'_phone.html'), src);
const URL = F('_phone.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({
    viewport:{width:390,height:844}, deviceScaleFactor:3,
    isMobile:true, hasTouch:true,
    userAgent: devices['iPhone 13'].userAgent
  });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({status:200, contentType:'text/javascript', body:FAKE}));
  const errs=[]; const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;console.log('  ok  '+n);} else {fail++;console.log('FAIL  '+n+(d!==undefined?'  '+d:''));} };

  const phone = await ctx.newPage(); watch(phone);
  await phone.goto(URL); await phone.waitForTimeout(400);
  await phone.fill('#roomInput','ALG2'); await phone.fill('#nameInput','Priya');
  await phone.tap('#joinStudent'); await phone.waitForTimeout(600);
  chk('student screen is showing', !(await phone.evaluate(()=>document.getElementById('viewBoard').hidden)));
  await phone.screenshot({path: path.join(HERE,'shot-phone-join.png')});

  // tapping the board must hand focus to the typing field, synchronously
  await phone.evaluate(()=>{ document.getElementById('hidden').blur(); });
  await phone.waitForTimeout(80);
  await phone.evaluate(()=>{
    window.__focusInGesture = false;
    const h = document.getElementById('hidden');
    const orig = h.focus.bind(h);
    h.focus = function(){ if(window.__inGesture) window.__focusInGesture = true; return orig(); };
    document.addEventListener('pointerdown', ()=>{ window.__inGesture = true;
      setTimeout(()=>{ window.__inGesture = false; }, 0); }, true);
  });
  const box = await phone.locator('#board').boundingBox();
  await phone.tap('#board', {position:{x:Math.min(60,box.width-10), y:Math.min(30,box.height-10)}});
  await phone.waitForTimeout(150);
  chk('board tap focuses the field inside the gesture',
      await phone.evaluate(()=>window.__focusInGesture));
  chk('the field really has focus',
      await phone.evaluate(()=>document.activeElement && document.activeElement.id === 'hidden'),
      await phone.evaluate(()=>document.activeElement && document.activeElement.id));

  // typing works
  await phone.keyboard.type('x^2'); await phone.keyboard.press('ArrowRight');
  await phone.keyboard.type('-9=0');
  await phone.waitForTimeout(400);
  chk('typing lands on the board',
      (await phone.evaluate(()=>window.__chalkline.tex())).includes('x^{2}-9=0'),
      await phone.evaluate(()=>window.__chalkline.tex()));

  // a teacher elsewhere pushes a problem
  const t = await ctx.newPage(); watch(t);
  await t.setViewportSize({width:390,height:844});
  await t.goto(URL); await t.waitForTimeout(400);
  await t.fill('#roomInput','ALG2'); await __signInTeacher(t);
  await t.waitForTimeout(600);
  const tiles = await t.evaluate(()=>document.querySelectorAll('.tile').length);
  chk('the phone shows up on the wall', tiles === 1, tiles);
  const seen = await t.evaluate(()=>window.__chalkboard.boards().map(b=>({n:b.name,l:b.lines})));
  chk('the phone\'s work reached the teacher',
      JSON.stringify(seen).includes('x^{2}-9=0'), JSON.stringify(seen));

  await t.tap('#tPush'); await t.waitForTimeout(400);
  await t.evaluate(()=>{ document.getElementById('hidden').focus(); });
  await t.keyboard.type('f(x)=x^3');
  await t.waitForTimeout(200);
  await t.evaluate(()=>document.getElementById('probSend').click());
  await phone.waitForTimeout(900);

  const strip = await phone.evaluate(()=>{
    const el = document.getElementById('probStrip');
    const r = el.getBoundingClientRect();
    return {hidden: el.hidden, collapsed: el.classList.contains('collapsed'),
            top:Math.round(r.top), bottom:Math.round(r.bottom),
            w:Math.round(r.width), h:Math.round(r.height),
            vis: getComputedStyle(el).display,
            text: el.innerText.slice(0,80)};
  });
  console.log('  strip:', JSON.stringify(strip));
  chk('problem strip is on screen on the phone',
      !strip.hidden && strip.h > 0 && strip.top < 844 && strip.bottom > 0, JSON.stringify(strip));
  await phone.screenshot({path: path.join(HERE,'shot-phone-problem.png')});

  console.log(`\nphone: ${pass} passed, ${fail} failed`);
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
