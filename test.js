const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const fs = require('fs');


(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(F('chalkline-board.html'));

  await page.waitForTimeout(300);

  await page.fill('#roomInput','TEST'); await page.fill('#nameInput','Tester');

  await page.click('#joinStudent');
  await page.waitForTimeout(400);

  const tex = () => page.evaluate(() => window.__chalkline.tex());
  const reset = async () => { await page.click('#clearAll'); await page.focus('#hidden'); };

  const results = [];
  async function T(name, keys, expect) {
    await reset();
    await page.keyboard.type(keys.text || '', { delay: 5 });
    if (keys.after) for (const k of keys.after) await page.keyboard.press(k);
    if (keys.text2) await page.keyboard.type(keys.text2, { delay: 5 });
    if (keys.after2) for (const k of keys.after2) await page.keyboard.press(k);
    if (keys.text3) await page.keyboard.type(keys.text3, { delay: 5 });
    const got = (await tex()).trim();
    results.push({ name, got, expect, pass: got === expect });
  }

  await T('quadratic + fraction', { text: '3x^2', after: ['ArrowRight'], text2: '+1/2' },
    '3x^{2}+\\frac{1}{2}');

  await T('nested fraction', { text: '1/2', after: ['ArrowRight'], text2: '+x/y' },
    '\\frac{1}{2}+\\frac{x}{y}');

  await T('radical', { text: 'sqrtx+1' }, '\\sqrt{x+1}');

  await T('radical then exit', { text: 'sqrt2', after: ['ArrowRight'], text2: '+5' },
    '\\sqrt{2}+5');

  await T('trig with parens', { text: 'sin(2x)' }, '\\sin\\left(2x\\right)');

  await T('trig squared', { text: 'cos^2', after: ['ArrowRight'], text2: '(theta)' },
    '\\cos^{2}\\left(\\theta\\right)');

  await T('log base', { text: 'log_3', after: ['ArrowRight'], text2: '(x)' },
    '\\log_{3}\\left(x\\right)');

  await T('fraction over binomial', { text: '(x+1)/(x-2)' },
    '\\frac{\\left(x+1\\right)}{\\left(x-2\\right)}');

  await T('quadratic formula (/ then / /)', { text: 'x=-b+-sqrtb^2', after: ['ArrowRight'], text2: '-4ac', after2: ['ArrowRight'], text3: '///2a' },
    'x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}');

  await T('absolute value', { text: '|2x-3|', text2: '<7' }, '\\left|2x-3\\right|<7');

  await T('cube root', { text: 'cbrt8' }, '\\sqrt[3]{8}');

  await T('backspace lands at end of denominator', { text: '1/2', after: ['ArrowRight', 'Backspace', 'Backspace'], text2: '5' },
    '\\frac{1}{5}');

  await T('backspace unwraps parens', { text: '(x+1)', after: ['ArrowLeft','ArrowLeft','ArrowLeft','ArrowLeft','Backspace'] },
    'x+1');
  await T('inequality combos', { text: '2x+-3<=7' }, '2x\\pm3\\le7');
  await T('a typed space between sin and x', { text: 'sin^2', after:['ArrowRight'], text2:'x+sin x' }, '\\sin^{2}x+\\sin~x');

  await T('pi and degrees', { text: 'theta=90deg' }, '\\theta=90^\\circ');

  await T('exponential', { text: '2^x', after: ['ArrowRight'], text2: '=8' }, '2^{x}=8');

  await T('subscript sequence', { text: 'a_n', after: ['ArrowRight'], text2: '=a_1', after2: ['ArrowRight'], text3: '+(n-1)d' },
    'a_{n}=a_{1}+\\left(n-1\\right)d');

  await T('sum then fraction', { text: '\\sum_{n=1}^{5} 1/n' },
    '\\sum_{n=1}^{5}~\\frac{1}{n}');

  await T('integral then fraction', { text: '\\int_0^1 x/2' },
    '\\int_{0}^{1}~\\frac{x}{2}');

  await T('lim typed then fraction', { text: '\\lim_{x \\to 0}sin x/x' },
    '\\lim_{x\\to0}\\frac{\\sin~x}{x}');

  await T('difference quotient', { text: '\\lim_{h \\to 0}f(x+h)-f(x)//h' },
    '\\lim_{h\\to0}\\frac{f\\left(x+h\\right)-f\\left(x\\right)}{h}');

  // palette: calculus templates
  await reset();
  await page.click('.pbtn[data-id="ddx"]');
  await page.keyboard.type('(x^3');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('-2x)');
  results.push({ name: 'palette d/dx', got: (await tex()).trim(),
    expect: '\\frac{d}{dx}\\left(x^{3}-2x\\right)', pass: null });

  await reset();
  await page.click('.pbtn[data-id="intDef"]');
  await page.keyboard.type('0');
  await page.keyboard.press('Tab');
  await page.keyboard.type('pi');
  results.push({ name: 'palette definite integral (no dx)', got: (await tex()).trim(),
    expect: '\\int_{0}^{\\pi}',
    pass: (await tex()).trim() === '\\int_{0}^{\\pi}' });

  await reset();
  await page.click('.pbtn[data-id="lim"]');
  await page.keyboard.type('x->0');
  results.push({ name: 'palette lim leaves a box for the expression', got: (await tex()).trim(),
    expect: '\\lim_{x\\to0}{}',
    pass: (await tex()).trim() === '\\lim_{x\\to0}{}' });

  await reset();
  await page.click('.pbtn[data-id="lim"]');
  await page.keyboard.type('x->a');
  await page.keyboard.press('Tab');          // into the box for the expression
  await page.keyboard.type('sin x/x');
  results.push({ name: 'lim button then fraction', got: (await tex()).trim(),
    expect: '\\lim_{x\\to a}\\frac{\\sin~x}{x}',
    pass: (await tex()).trim() === '\\lim_{x\\to a}\\frac{\\sin~x}{x}' });

  // the general derivative buttons: bare boxes, no brackets
  await reset();
  await page.click('.pbtn[data-id="dgen"]');
  results.push({ name: 'd/d box has no brackets', got: (await tex()).trim(),
    expect: '\\frac{d{}}{d{}}', pass: (await tex()).trim() === '\\frac{d{}}{d{}}' });

  await reset();
  await page.click('.pbtn[data-id="dgen"]');
  await page.keyboard.type('y'); await page.keyboard.press('Tab'); await page.keyboard.type('x');
  results.push({ name: 'filled boxes vanish from the LaTeX', got: (await tex()).trim(),
    expect: '\\frac{dy}{dx}', pass: (await tex()).trim() === '\\frac{dy}{dx}' });

  // an empty box asked for by a button survives a round trip through sync
  await reset();
  await page.click('.pbtn[data-id="sum"]');
  results.push({ name: 'empty bounds persist', got: (await tex()).trim(),
    expect: '\\sum_{}^{}', pass: (await tex()).trim() === '\\sum_{}^{}' });

  // import: paste LaTeX straight onto the board
  await reset();
  await page.click('#importBtn');
  await page.fill('#importText', '\\int_0^1 x^2\\,dx\n\\frac{d}{dx}\\left(\\sin x\\right)\n\\lim_{x \\to 0}\\frac{\\sin x}{x}');
  await page.click('#importGo');
  await page.waitForTimeout(150);
  results.push({ name: 'paste LaTeX (3 lines)', got: (await tex()).trim(), expect: '(3 imported lines)', pass: null });

  // multi-line + note line
  await reset();
  await page.keyboard.type('x^2');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('-9=0');
  await page.keyboard.press('Enter');
  await page.keyboard.type('(x-3)(x+3)=0');
  results.push({ name: 'multi-line', got: (await tex()).trim(), expect: '(2 lines)', pass: null });

  // showcase render
  await reset();
  await page.click('#importBtn');
  await page.fill('#importText', [
    '\\frac{d}{dx}\\left(3x^{4}-\\sqrt{x}\\right)',
    '\\int_{0}^{\\pi}\\sin x\\,dx = 2',
    '\\int\\left(3x^{2}-1\\right)dx',
    '\\lim_{x \\to 0}\\frac{\\sin x}{x}=1',
    '\\sum_{n=1}^{\\infty}\\frac{1}{n^{2}}=\\frac{\\pi^{2}}{6}',
    "\\frac{\\partial}{\\partial x}\\left(x^{2}y\\right)",
    'x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}'
  ].join('\n'));
  await page.click('#importGo');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(HERE,'shot-showcase.png') });
  results.push({ name: 'showcase', got: (await tex()).trim(), expect: '(visual)', pass: null });

  console.log('\n=== RESULTS ===');
  for (const r of results) {
    const mark = r.pass === null ? '·' : (r.pass ? 'PASS' : 'FAIL');
    console.log(`[${mark}] ${r.name}`);
    if (r.pass !== true) {
      console.log(`      got:    ${r.got}`);
      if (r.pass === false) console.log(`      expect: ${r.expect}`);
    }
  }
  console.log('\n=== ERRORS ===');
  console.log(errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
