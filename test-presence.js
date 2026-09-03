/* The wall shows who is in the room now, not who was here once. */
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
fs.writeFileSync(path.join(HERE,'_pres.html'), src);
const URL = F('_pres.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1280,height:900} });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({status:200, contentType:'text/javascript', body:FAKE}));
  const errs=[]; const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;} else {fail++;console.log('FAIL  '+n+(d!==undefined?'  '+d:''));} };

  const t = await ctx.newPage(); watch(t);
  await t.goto(URL); await t.waitForTimeout(500);
  await t.fill('#roomInput','PRES'); await t.click('#joinTeacher'); await t.waitForTimeout(250);
  await t.fill('#tEmail','mr@chalkline.test'); await t.fill('#tPass','correct-horse');
  await t.click('#tSignIn'); await t.waitForTimeout(800);

  const student = async name => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForTimeout(400);
    await p.fill('#roomInput','PRES'); await p.fill('#nameInput', name);
    await p.click('#joinStudent'); await p.waitForTimeout(600);
    return p;
  };
  const tiles = () => t.evaluate(()=>[...document.querySelectorAll('.tile .tilehead b')].map(e=>e.textContent).sort());
  const names = () => t.evaluate(()=>window.__chalkboard.boards().map(x=>x.name).sort());

  const priya = await student('Priya');
  const sam   = await student('Sam');
  await priya.focus('#hidden'); await priya.keyboard.type('x^2', {delay:4});
  await t.waitForTimeout(900);
  chk('both students show while they are here',
      JSON.stringify(await tiles()) === '["Priya","Sam"]', JSON.stringify(await tiles()));

  /* ---- a student whose heartbeat stops falls off the wall ----
     Sam's tab goes away and his board lingers in the room, the way it would if
     the browser died rather than closed cleanly. Aged by hand so the test does
     not have to sit through half a minute. */
  await sam.close();
  await t.evaluate(()=>{
    const r = globalThis.__fakeStore.rooms.PRES;
    for(const k in r.boards) if(r.boards[k].name === 'Sam') r.boards[k].at = Date.now() - 120000;
    const b = window.__chalkboard.boards().find(x => x.name === 'Sam');
    if(b) b.at = Date.now() - 120000;
  });
  await t.evaluate(()=>window.__chalkboard.sweep());
  await t.waitForTimeout(300);
  chk('a student who has gone quiet drops off the wall',
      JSON.stringify(await tiles()) === '["Priya"]', JSON.stringify(await tiles()));
  chk('and out of the teacher\'s list too',
      JSON.stringify(await names()) === '["Priya"]', JSON.stringify(await names()));
  chk('their board is cleared out of the room as well', await t.evaluate(()=>{
    const r = ((globalThis.__fakeStore||{}).rooms||{}).PRES||{};
    return Object.values(r.boards||{}).every(x => x.name !== 'Sam');
  }), await t.evaluate(()=>JSON.stringify((((globalThis.__fakeStore||{}).rooms||{}).PRES||{}).boards)));

  /* ---- the student still typing is untouched ---- */
  await priya.focus('#hidden'); await priya.keyboard.press('ArrowRight');
  await priya.keyboard.type('+1', {delay:4});
  await t.waitForTimeout(900);
  chk('the student still working stays put',
      JSON.stringify(await tiles()) === '["Priya"]', JSON.stringify(await tiles()));
  chk('with their work intact',
      JSON.stringify(await t.evaluate(()=>window.__chalkboard.boards()[0].lines)).includes('x^{2}+1'),
      JSON.stringify(await t.evaluate(()=>window.__chalkboard.boards()[0].lines)));

  /* ---- a board left over from an earlier lesson never appears ---- */
  await t.evaluate(()=>globalThis.__fakeWrite('rooms/PRES/boards/ghost-uid',
      {name:'Absent Alex', lines:['\\frac{1}{2}'], at: Date.now() - 4*60*60*1000}));
  // don't race the five-second sweep — ask for it
  await t.waitForTimeout(500);
  await t.evaluate(()=>window.__chalkboard.sweep());
  await t.waitForTimeout(300);
  const after = await tiles();
  chk('a board left from an earlier lesson is not drawn',
      !after.includes('Absent Alex'), JSON.stringify(after));
  // the removal is a write and then a broadcast, so poll for it rather than
  // guessing at a sleep long enough to cover both
  let gone = false;
  for(let i = 0; i < 20 && !gone; i++){
    gone = await t.evaluate(()=>{
      const r = ((globalThis.__fakeStore||{}).rooms||{}).PRES||{};
      return !(r.boards||{})['ghost-uid'];
    });
    if(!gone) await t.waitForTimeout(150);
  }
  chk('and is cleared out rather than left lying around', gone);

  /* ---- someone rejoining comes straight back ---- */
  const sam2 = await student('Sam');
  await t.waitForTimeout(900);
  chk('a student who comes back appears again',
      JSON.stringify(await tiles()) === '["Priya","Sam"]', JSON.stringify(await tiles()));

  chk('nothing threw', errs.length === 0, errs.join(' | '));
  console.log(`\npresence: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
