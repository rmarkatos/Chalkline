const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const URL = F('chalkline-board.html');

const CASES = [
  ['quadratic formula', 'x=-b+-sqrtb^2', ['ArrowRight'], '-4ac', ['ArrowRight'], '///2a',
   'x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}'],
  ['trig identity', 'sin^2', ['ArrowRight'], '(theta)+cos^2', ['ArrowRight'], '(theta)=1',
   '\\sin^{2}\\left(\\theta\\right)+\\cos^{2}\\left(\\theta\\right)=1'],
  ['raw latex', '\\int_0^{\\pi}\\sin x\\,dx', [], '', [], '', '\\int_{0}^{\\pi}\\sin x\\,dx'],
  ['words and math', '$Since $b^2 -4ac<0$ there are no real roots.', [], '', [], '',
   '\\text{Since }b^{2}-4ac<0\\text{ there are no real roots.}'],
  ['number set', 'x\\in\\mathbb{R}', [], '', [], '', 'x\\in\\mathbb{R}'],
  ['limit of a fraction', '\\lim_{x \\to 0}sin x/x', [], '', [], '', '\\lim_{x\\to0}\\frac{\\sin~x}{x}'],
];

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport:{width:1280,height:900} });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(300);
  await p.fill('#roomInput','TEST'); await p.fill('#nameInput','Tester');
  await p.click('#joinStudent'); await p.waitForTimeout(300);

  let pass = 0;
  for(const [name, t1, k1, t2, k2, t3, want] of CASES){
    await p.click('#clearAll'); await p.focus('#hidden');
    await p.keyboard.type(t1, {delay:4});
    for(const k of k1) await p.keyboard.press(k);
    if(t2) await p.keyboard.type(t2, {delay:4});
    for(const k of k2) await p.keyboard.press(k);
    if(t3) await p.keyboard.type(t3, {delay:4});
    const got = (await p.evaluate(()=>window.__chalkline.tex())).trim();
    if(got === want) pass++;
    else { console.log(`FAIL ${name}`); console.log(`  got:  ${got}`); console.log(`  want: ${want}`); }
  }
  // palette and paste still work inside the app
  await p.click('#clearAll'); await p.click('.pbtn[data-id="lim"]');
  await p.keyboard.type('x->0'); await p.keyboard.press('Tab'); await p.keyboard.type('1/x');
  const pal = (await p.evaluate(()=>window.__chalkline.tex())).trim();
  if(pal === '\\lim_{x\\to0}\\frac{1}{x}') pass++; else console.log('FAIL palette lim: ' + pal);

  await p.click('#clearAll'); await p.click('#importBtn');
  await p.fill('#importText','\\frac{d}{dx}\\left(3x^{4}\\right)');
  await p.click('#importGo'); await p.waitForTimeout(200);
  const imp = (await p.evaluate(()=>window.__chalkline.tex())).trim();
  if(imp === '\\frac{d}{dx}\\left(3x^{4}\\right)') pass++; else console.log('FAIL paste: ' + imp);

  console.log(`editor inside the app: ${pass}/${CASES.length + 2} passed`);
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
