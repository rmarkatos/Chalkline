/* A note pinned to one line of a student's work. */
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
fs.writeFileSync(path.join(HERE,'_notes.html'), src);
const URL = F('_notes.html');

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
  await t.fill('#roomInput','NOTES');
  await t.click('#joinTeacher'); await t.waitForTimeout(250);
  await t.fill('#tEmail','mr@chalkline.test'); await t.fill('#tPass','correct-horse');
  await t.click('#tSignIn'); await t.waitForTimeout(800);

  const kid = await ctx.newPage(); watch(kid);
  await kid.goto(URL); await kid.waitForTimeout(400);
  await kid.fill('#roomInput','NOTES'); await kid.fill('#nameInput','Priya');
  await kid.click('#joinStudent'); await kid.waitForTimeout(600);
  await kid.focus('#hidden');
  await kid.keyboard.type('2x+6=14', {delay:5}); await kid.keyboard.press('Enter');
  await kid.keyboard.type('2x=6', {delay:5});    await kid.keyboard.press('Enter');
  await kid.keyboard.type('x=4', {delay:5});
  await t.waitForTimeout(1100);

  await t.click('.tile'); await t.waitForTimeout(500);
  chk('the work panel lists every line',
      (await t.evaluate(()=>document.querySelectorAll('#workLines .wrow').length)) === 3);
  chk('each line offers a note',
      (await t.evaluate(()=>document.querySelectorAll('#workLines .wadd').length)) === 3);
  chk('and none is written yet',
      (await t.evaluate(()=>document.querySelectorAll('#workLines .wnote').length)) === 0);

  const noteOn = async (i, text) => {
    await t.evaluate(n=>{
      const rows=[...document.querySelectorAll('#workLines .wrow')];
      rows[n].querySelector('.wadd').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
    }, i);
    await t.waitForTimeout(250);
    await t.keyboard.type(text, {delay:8});
    await t.waitForTimeout(200);
    await t.keyboard.press('Enter');
    await t.waitForTimeout(700);
  };
  const studentNotes = () => kid.evaluate(()=>
    [...document.querySelectorAll('#board .line')].map((r,i)=>{
      const n = r.querySelector('.wnote .wnotebox');
      return n ? (i+1) + ':' + n.innerText.replace(/\s+/g,'') : null;
    }).filter(Boolean));

  await noteOn(2, 'check this');
  chk('the note appears in the work panel',
      (await t.evaluate(()=>document.querySelectorAll('#workLines .wnote').length)) === 1);
  chk('and reaches the student on the right line',
      JSON.stringify(await studentNotes()) === '["3:checkthis"]',
      JSON.stringify(await studentNotes()));

  /* ---- a second note, on a different line ---- */
  await noteOn(0, 'good start');
  chk('a second note lands on its own line',
      JSON.stringify(await studentNotes()) === '["1:goodstart","3:checkthis"]',
      JSON.stringify(await studentNotes()));

  /* ---- the notes are real mathematics, not text ---- */
  await t.evaluate(()=>{
    const rows=[...document.querySelectorAll('#workLines .wrow')];
    rows[1].querySelector('.wadd').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await t.waitForTimeout(250);
  await t.keyboard.type('x=3', {delay:8});
  await t.waitForTimeout(200);
  await t.keyboard.press('Enter'); await t.waitForTimeout(800);
  chk('a note is typeset like everything else',
      await kid.evaluate(()=>{
        const rows=[...document.querySelectorAll('#board .line')];
        const box = rows[1].querySelector('.wnote .wnotebox');
        return !!box && !!box.querySelector('.at');   // an italic variable
      }));

  /* ---- a note is a maths field with everything the editor can do ---- */
  // line 2 has no note yet, so start from an empty box
  await t.evaluate(()=>{
    const rows=[...document.querySelectorAll('#workLines .wrow')];
    rows[1].querySelector('.wadd').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await t.waitForTimeout(250);
  await t.keyboard.press('Control+a'); await t.keyboard.press('Backspace');
  await t.waitForTimeout(150);
  const noteBox = () => t.evaluate(()=>{
    const n=document.querySelector('#workLines .wnote.here .wnotebox');
    return n ? {txt:n.innerText.replace(/\s+/g,''), caret:!!n.querySelector('.cursor'),
                frac:!!n.querySelector('.frac'), sqrt:!!n.querySelector('.sqrt')} : null;
  });
  chk('a note opens with a caret in it', (await noteBox()).caret, JSON.stringify(await noteBox()));

  /* typing shows straight away, without waiting on the student */
  await t.keyboard.type('a', {delay:0});
  await t.waitForTimeout(60);
  chk('a keystroke shows immediately', (await noteBox()).txt === 'a', JSON.stringify(await noteBox()));

  /* the shortcuts work */
  await t.keyboard.press('Backspace');
  await t.keyboard.type('1/2', {delay:10}); await t.waitForTimeout(150);
  chk('a fraction can be typed in a note', (await noteBox()).frac, JSON.stringify(await noteBox()));

  /* and the palette */
  await t.click('.pbtn[data-id="sqrt"]'); await t.waitForTimeout(200);
  chk('the palette works in a note', (await noteBox()).sqrt, JSON.stringify(await noteBox()));

  /* the student working does not tear the note down mid-sentence */
  const before = await t.evaluate(()=>document.querySelector('#workLines .wnote.here .wnotebox'));
  await kid.focus('#hidden');
  await kid.keyboard.type('zzz', {delay:30});
  await t.waitForTimeout(900);
  chk('the note survives the student typing at the same time',
      (await noteBox()) !== null && (await noteBox()).caret,
      JSON.stringify(await noteBox()));

  await t.keyboard.press('Enter'); await t.waitForTimeout(900);
  chk('and the work panel catches up once the note is finished',
      (await t.evaluate(()=>document.getElementById('workLines').innerText)).includes('zzz'),
      await t.evaluate(()=>document.getElementById('workLines').innerText.replace(/\s+/g,' ')));

  // put line 2's note back to what the later checks expect
  await t.evaluate(()=>{
    const rows=[...document.querySelectorAll('#workLines .wrow')];
    rows[1].querySelector('.wadd').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await t.waitForTimeout(200);
  await t.keyboard.press('Control+a'); await t.keyboard.press('Backspace');
  await t.keyboard.type('x=3', {delay:8});
  await t.keyboard.press('Enter'); await t.waitForTimeout(700);

  /* ---- the note is pinned to the LINE, not the line number ---- */
  await kid.evaluate(()=>{
    const b=document.querySelectorAll('#board .line')[0];
    b.querySelector('.linebody').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await kid.waitForTimeout(200);
  await kid.keyboard.press('Enter');
  await kid.keyboard.type('let me redo this', {delay:4});
  await kid.waitForTimeout(1200);
  chk('inserting a line above moves the notes with the work',
      JSON.stringify(await studentNotes()) === '["1:goodstart","3:x=3","4:checkthis"]',
      JSON.stringify(await studentNotes()));

  /* ---- removing one ---- */
  await t.waitForTimeout(600);
  await t.evaluate(()=>{
    const n=[...document.querySelectorAll('#workLines .wnote')];
    n[0].querySelector('.wnotex').click();
  });
  await t.waitForTimeout(800);
  chk('a removed note goes from the student too',
      (await studentNotes()).length === 2, JSON.stringify(await studentNotes()));

  /* ---- they travel with the feedback, in one payload ---- */
  const stored = await t.evaluate(()=>{
    const r = ((globalThis.__fakeStore||{}).rooms||{}).NOTES||{};
    const fb = r.feedback || {};
    const k = Object.keys(fb)[0];
    return k ? fb[k] : null;
  });
  chk('the notes are stored beside the feedback',
      stored && stored.notes && Object.keys(stored.notes).length === 2,
      JSON.stringify(stored));

  /* ---- closing the board clears them ---- */
  await t.evaluate(()=>document.getElementById('actingBack').click());
  await t.waitForTimeout(300);
  await t.click('#tClose'); await t.waitForTimeout(1500);
  chk('closing the board takes the notes away',
      (await studentNotes()).length === 0, JSON.stringify(await studentNotes()));

  /* ---- a click that cannot work says so, instead of doing nothing ---- */
  await t.evaluate(()=>{ const b=document.getElementById('errBar'); b.hidden=true;
                         document.getElementById('errList').textContent=''; });
  await t.evaluate(()=>window.__chalkboard.openBoard('nobody-here'));
  await t.waitForTimeout(200);
  chk('opening a student who has gone says why, rather than nothing',
      /no longer on the wall/.test(await t.evaluate(()=>
        document.getElementById('errList').innerText)),
      await t.evaluate(()=>document.getElementById('errList').innerText));

  chk('nothing threw', errs.length === 0, errs.join(' | '));
  console.log(`\nline notes: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
