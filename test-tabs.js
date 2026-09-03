/* Two student tabs on one machine are two students, not one. */
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
fs.writeFileSync(path.join(HERE,'_tabs.html'), src);
const URL = F('_tabs.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({status:200, contentType:'text/javascript', body:FAKE}));
  const errs=[]; const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;} else {fail++;console.log('FAIL  '+n+(d!==undefined?'  '+d:''));} };

  const t = await ctx.newPage(); watch(t);
  await t.goto(URL); await t.waitForTimeout(500);
  await t.fill('#roomInput','TABS');
  await t.click('#joinTeacher'); await t.waitForTimeout(250);
  await t.fill('#tEmail','mr@chalkline.test'); await t.fill('#tPass','correct-horse');
  await t.click('#tSignIn'); await t.waitForTimeout(800);

  const student = async name => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForTimeout(400);
    await p.fill('#roomInput','TABS'); await p.fill('#nameInput', name);
    await p.click('#joinStudent'); await p.waitForTimeout(700);
    return p;
  };
  // both tabs share one browser, so one anonymous sign-in between them
  const priya = await student('Priya');
  const daniel = await student('Daniel');
  await priya.focus('#hidden'); await priya.keyboard.type('2x=6', {delay:5});
  await daniel.focus('#hidden'); await daniel.keyboard.type('y=mx+b', {delay:5});
  await t.waitForTimeout(1400);

  const wall = () => t.evaluate(()=>window.__chalkboard.boards()
    .map(x=>x.name + ':' + (x.lines||[]).join('')).sort());
  chk('two tabs are two students on the wall',
      JSON.stringify(await wall()) === '["Daniel:y=mx+b","Priya:2x=6"]',
      JSON.stringify(await wall()));
  chk('and they are two tiles',
      (await t.evaluate(()=>document.querySelectorAll('.tile').length)) === 2);

  /* a note for one must not appear on the other */
  const openByName = async name => {
    await t.evaluate(n=>{
      const tile=[...document.querySelectorAll('.tile')].find(x=>x.innerText.startsWith(n));
      tile.click();
    }, name);
    await t.waitForTimeout(500);
  };
  await openByName('Priya');
  chk('the panel shows that student\u2019s work',
      (await t.evaluate(()=>document.getElementById('workLines').innerText)).includes('2x'),
      await t.evaluate(()=>document.getElementById('workLines').innerText.replace(/\s+/g,' ')));
  await t.evaluate(()=>{
    const rows=[...document.querySelectorAll('#workLines .wrow')];
    rows[0].querySelector('.wadd').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await t.waitForTimeout(250);
  await t.keyboard.type('for Priya', {delay:8});
  await t.keyboard.press('Enter'); await t.waitForTimeout(900);

  const notesOn = p => p.evaluate(()=>[...document.querySelectorAll('#board .wnote .wnotebox')]
    .map(n=>n.innerText.replace(/\s+/g,'')));
  chk('the note reaches the student it was for',
      JSON.stringify(await notesOn(priya)) === '["forPriya"]', JSON.stringify(await notesOn(priya)));
  chk('and not the other tab',
      JSON.stringify(await notesOn(daniel)) === '[]', JSON.stringify(await notesOn(daniel)));

  /* the same is true of the checkmark */
  await t.click('#actingCheck'); await t.waitForTimeout(800);
  chk('a checkmark lands on the right student only',
      !(await priya.evaluate(()=>document.getElementById('tickBadge').hidden)) &&
       (await daniel.evaluate(()=>document.getElementById('tickBadge').hidden)));

  /* and neither tab overwrites the other's board */
  await priya.focus('#hidden'); await priya.keyboard.type('+1', {delay:5});
  await t.waitForTimeout(1200);
  chk('both boards survive side by side',
      JSON.stringify(await wall()).includes('y=mx+b') &&
      JSON.stringify(await wall()).includes('2x=6+1'),
      JSON.stringify(await wall()));

  /* ---- every visit is a first visit ---- */
  await priya.reload(); await priya.waitForTimeout(1400);
  chk('a student who reloads starts with a clean board',
      (await priya.evaluate(()=>window.__chalkline.tex())).trim() === '',
      JSON.stringify(await priya.evaluate(()=>window.__chalkline.tex())));
  chk('and carries nothing over — no note, no checkmark',
      (await notesOn(priya)).length === 0 &&
      (await priya.evaluate(()=>document.getElementById('tickBadge').hidden)),
      JSON.stringify(await notesOn(priya)));
  await priya.focus('#hidden'); await priya.keyboard.type('starting again', {delay:4});
  await t.waitForTimeout(1200);
  chk('and they can work straight away',
      JSON.stringify(await wall()).includes('startingagain') ||
      JSON.stringify(await wall()).includes('starting'),
      JSON.stringify(await wall()));

  chk('nothing threw', errs.length === 0, errs.join(' | '));
  console.log(`\ntwo tabs: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
