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
  const chk = (n, ok, d) => { if(ok) pass++; else { fail++; console.log('FAIL ' + n + (d ? '  ' + d : '')); } };

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
  await priya.focus('#hidden'); await priya.keyboard.type('x=1');
  await teacher.waitForTimeout(500);

  // compose: image + a line of maths + a 2 minute timer
  await teacher.click('#tPush'); await teacher.waitForTimeout(200);
  await teacher.setInputFiles('#probFile', path.join(HERE,'problem.png'));
  await teacher.waitForTimeout(500);
  chk('attachment chip shows', await teacher.evaluate(()=>!document.getElementById('probChip').hidden));
  chk('chip names the file', (await teacher.evaluate(()=>document.getElementById('probChipName').textContent)).includes('problem.png'));

  await teacher.focus('#hidden');
  await teacher.keyboard.type('f(x)=x^3', {delay:4});
  await teacher.keyboard.press('ArrowRight');
  await teacher.keyboard.type('-6x^2', {delay:4});
  await teacher.keyboard.press('ArrowRight');
  await teacher.keyboard.type('+9x', {delay:4});
  await teacher.fill('#probMins','2');
  await teacher.click('#probSend');
  await teacher.waitForTimeout(800);

  chk('back on the teacher wall', await teacher.evaluate(()=>!document.getElementById('viewTeacher').hidden));
  chk('teacher clock running', await teacher.evaluate(()=>{
    const c = document.getElementById('tClock'); return !c.hidden && /^[0-9]+:[0-9]{2}$/.test(c.textContent); }),
    await teacher.evaluate(()=>document.getElementById('tClock').textContent));

  // students got the picture, the maths, and the clock
  for(const [name, p] of [['Priya', priya], ['Sam', sam]]){
    chk(name + ' sees the strip', await p.evaluate(()=>!document.getElementById('probStrip').hidden));
    const n = await p.evaluate(()=>document.querySelectorAll('#probBody .probimgs img').length);
    chk(name + ' sees 1 image', n === 1, 'got ' + n);
    const src = await p.evaluate(()=>{const i=document.querySelector('#probBody .probimgs img'); return i ? i.src.slice(0,22) : null;});
    chk(name + ' image is real data', src === 'data:image/jpeg;base64', src);
    const clock = await p.evaluate(()=>document.getElementById('probClock').textContent);
    chk(name + ' clock running', /^[0-9]+:[0-9]{2}$/.test(clock), clock);
  }
  chk('Priya kept her work', (await priya.evaluate(()=>window.__chalkline.tex())).startsWith('x=1'),
      await priya.evaluate(()=>window.__chalkline.tex()));
  chk('problem maths goes to the strip, not their work',
      (await sam.evaluate(()=>document.getElementById('probBody').innerText)).includes('f'),
      await sam.evaluate(()=>document.getElementById('probBody').innerText));

  // students can still type with the strip open
  await priya.focus('#hidden'); await priya.keyboard.press('Enter'); await priya.keyboard.type("f'(x)=3x^2");
  chk('typing works under the strip', (await priya.evaluate(()=>window.__chalkline.tex())).includes("f'\\left(x\\right)=3x^{2}"));

  // hide/show the picture
  await priya.click('#probToggle'); await priya.waitForTimeout(100);
  chk('picture collapses', await priya.evaluate(()=>document.getElementById('probStrip').classList.contains('collapsed')));
  chk('toggle relabels', (await priya.evaluate(()=>document.getElementById('probToggle').textContent)) === 'Show');
  await priya.keyboard.press('ArrowRight');   // step out of the exponent first
  await priya.keyboard.type('+1');
  chk('typing survives the toggle', (await priya.evaluate(()=>window.__chalkline.tex())).includes('3x^{2}+1'),
      await priya.evaluate(()=>window.__chalkline.tex()));

  // a timer on its own, and the countdown actually counting
  const before = await sam.evaluate(()=>document.getElementById('probClock').textContent);
  await sam.waitForTimeout(2200);
  const after = await sam.evaluate(()=>document.getElementById('probClock').textContent);
  chk('clock ticks down', before !== after, before + ' -> ' + after);

  await sam.focus('#hidden'); await sam.keyboard.type('2x+1', {delay:4});
  await teacher.click('#tPush'); await teacher.waitForTimeout(150);
  await teacher.fill('#probMins','0.05');          // 3 seconds
  await teacher.click('#probSend'); await teacher.waitForTimeout(4200);
  chk("student sees Time's up", (await sam.evaluate(()=>document.getElementById('probClock').textContent)) === "Time's up",
      await sam.evaluate(()=>document.getElementById('probClock').textContent));
  // reversed deliberately: time running out now stops further work
  chk('locked out after time', await sam.evaluate(()=>!document.getElementById('lockBar').hidden));
  const held = (await sam.evaluate(()=>window.__chalkline.tex())).trim();
  await sam.focus('#hidden'); await sam.keyboard.type('=2');
  chk('cannot type after time', (await sam.evaluate(()=>window.__chalkline.tex())).trim() === held,
      await sam.evaluate(()=>window.__chalkline.tex()));
  chk('but the work is still on screen', held.length > 0, held);

  await priya.screenshot({ path: path.join(HERE,'shot-problem.png') });
  console.log(`\npush + timer: ${pass} passed, ${fail} failed`);
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
