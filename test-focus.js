const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const URL = F('chalkline-board.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport:{width:1280,height:900} });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(300);
  await p.fill('#nameInput','Priya'); await p.click('#joinStudent'); await p.waitForTimeout(300);

  const tex = () => p.evaluate(()=>window.__chalkline.tex());
  const armed = () => p.evaluate(()=>document.activeElement && document.activeElement.id === 'hidden');
  let pass = 0, fail = 0;
  const chk = (name, ok, detail) => { if(ok) pass++; else { fail++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); } };

  // 1. after the Theme button, typing must still work
  await p.keyboard.type('1+1');
  await p.click('#themeBtn'); await p.waitForTimeout(80);
  chk('focus after Theme', await armed());
  await p.keyboard.type('=2');
  chk('types after Theme', (await tex()).trim() === '1+1=2', await tex());

  // 2. clicking the board's empty padding
  await p.click('#clearAll'); await p.keyboard.type('x^2');
  await p.evaluate(()=>document.getElementById('hidden').blur());
  chk('blur really drops focus', !(await armed()));
  const box = await p.locator('.board').boundingBox();
  await p.mouse.click(box.x + box.width - 40, box.y + box.height - 25);  // padding, no line
  await p.waitForTimeout(80);
  chk('focus after clicking board padding', await armed());
  await p.keyboard.press('ArrowRight'); await p.keyboard.type('+1');
  chk('types after padding click', (await tex()).trim() === 'x^{2}+1', await tex());

  // 3. clicking dead space outside the board. Not the inspector — that one is
  //    deliberately left alone so its LaTeX can be selected and copied.
  await p.evaluate(()=>document.getElementById('hidden').blur());
  await p.mouse.click(900, 500);
  await p.waitForTimeout(80);
  chk('focus after clicking the page', await armed());

  // 4. the paste box must keep focus while open
  await p.click('#importBtn'); await p.waitForTimeout(120);
  chk('paste box holds focus', await p.evaluate(()=>document.activeElement.id === 'importText'));
  await p.click('#importCancel'); await p.waitForTimeout(80);
  chk('focus returns after cancel', await armed());

  // 5. the board shows when it holds the keyboard
  chk('armed ring shown', await p.evaluate(()=>document.querySelector('.board').classList.contains('armed')));

  // 6. definite integral no longer writes dx
  await p.click('#clearAll');
  await p.click('.pbtn[data-id="intDef"]');
  await p.keyboard.type('0'); await p.keyboard.press('Tab'); await p.keyboard.type('pi');
  await p.keyboard.press('Tab'); await p.keyboard.type('3x^2');
  const integ = (await tex()).trim();
  chk('definite integral has no dx', integ === '\\int_{0}^{\\pi}3x^{2}', integ);

  console.log(`\nfocus + integral: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
