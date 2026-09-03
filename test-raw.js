const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};

const CASES = [
  // [what the student types, expected LaTeX on the line]
  ['\\frac{1}{2}',                 '\\frac{1}{2}'],
  ['\\frac{x+1}{x-2}',             '\\frac{x+1}{x-2}'],
  ['\\sqrt{x+1}',                  '\\sqrt{x+1}'],
  ['\\sqrt[3]{27}',                '\\sqrt[3]{27}'],
  ['\\alpha+\\beta ',              '\\alpha+\\beta'],
  ['\\pi r^2',                     '\\pi r^{2}'],
  ['\\theta =\\pi ',               '\\theta=\\pi'],
  ['\\int_0^1 ',                   '\\int_{0}^{1}~'],
  ['\\int_{0}^{\\pi}',             '\\int_{0}^{\\pi}'],
  ['\\sum_{n=1}^{10}n',            '\\sum_{n=1}^{10}n'],
  ['\\lim_{x\\to 0}',              '\\lim_{x\\to0}'],
  ['\\left(x+1\\right)',           '\\left(x+1\\right)'],
  ['\\frac{d}{dx}',                '\\frac{d}{dx}'],
  ['x\\le 5',                      'x\\le5'],
  ['\\sin ^2',                     '\\sin^{2}'],
  ['\\infty ',                     '\\infty'],
  ['\\frac{1}{2}+\\frac{1}{3}',    '\\frac{1}{2}+\\frac{1}{3}'],
  ['2\\cdot 3',                    '2\\cdot3'],
  ['\\begin{cases}x\\\\y\\end{cases}', '\\begin{cases}x \\\\ y\\end{cases}'],
  // braces typed as LaTeX grouping, not as literal characters
  ['x^{4}-\\sqrt{x}',             'x^{4}-\\sqrt{x}'],
  ['a_{n}+1',                     'a_{n}+1'],
  ['\\int_0^{\\pi}\\sin x\\,dx',  '\\int_{0}^{\\pi}\\sin x\\,dx'],
  ['e^{x^{2}}+1',                 'e^{x^{2}}+1'],
  ['\\frac{1}{2}x^{2}+3',         '\\frac{1}{2}x^{2}+3'],
  ['\\{x\\}',                     '\\left\\{x\\right\\}'],
  // bounds typed after the operator has already been committed
  ['\\int _a^b',                  '\\int_{a}^{b}'],
  ['\\sum _{n=1}^{10}',           '\\sum_{n=1}^{10}'],
  ['\\int _0^1 3x^{2}\\,dx',      '\\int_{0}^{1}3x^{2}\\,dx'],
  // number sets
  ['x\\in\\mathbb{R}',            'x\\in\\mathbb{R}'],
  ['n\\in\\mathbb{Z},n>0',        'n\\in\\mathbb{Z},n>0'],
  ['\\mathbb{N}\\subset\\mathbb{Z}', '\\mathbb{N}\\subset\\mathbb{Z}'],
  ['a\\in\\R ',                   'a\\in\\mathbb{R}'],
];

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport:{width:1280,height:900} });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(F('chalkline-board.html'));
  await p.waitForTimeout(300);
  await p.fill('#roomInput','TEST'); await p.fill('#nameInput','Tester');
  await p.click('#joinStudent');

  let pass = 0; const fails = [];
  for(const [typed, want] of CASES){
    await p.click('#clearAll'); await p.focus('#hidden');
    await p.keyboard.type(typed, { delay: 4 });
    const got = (await p.evaluate(() => window.__chalkline.tex())).trim();
    if(got === want) pass++; else fails.push({typed, got, want});
  }

  // mixed: raw LaTeX and shortcut typing in the same expression
  await p.click('#clearAll'); await p.focus('#hidden');
  await p.keyboard.type('x=\\frac{-b\\pm \\sqrt{b^2-4ac}}{2a}', {delay:4});
  const mixed = (await p.evaluate(() => window.__chalkline.tex())).trim();

  // escape abandons a half-typed command
  await p.click('#clearAll'); await p.focus('#hidden');
  await p.keyboard.type('1+\\alph');
  await p.keyboard.press('Escape');
  await p.keyboard.type('2');
  const esc = (await p.evaluate(() => window.__chalkline.tex())).trim();

  // an unknown command is reported, not swallowed
  await p.click('#clearAll'); await p.focus('#hidden');
  await p.keyboard.type('\\foo ');
  const warn = await p.evaluate(() => document.getElementById('texWarn').textContent);

  // the pending buffer is visible while typing
  await p.click('#clearAll'); await p.focus('#hidden');
  await p.keyboard.type('\\frac{1}');
  const shown = await p.evaluate(() => { const e=document.querySelector('.pending'); return e ? e.textContent : null; });
  await p.screenshot({ path:'shot-pending.png' });

  console.log(`raw LaTeX typing: ${pass}/${CASES.length} passed`);
  for(const f of fails){
    console.log(`  FAIL  typed: ${f.typed}`);
    console.log(`        got:   ${f.got}`);
    console.log(`        want:  ${f.want}`);
  }
  console.log('mixed quadratic:', mixed);
  console.log('escape cancels: ', esc, esc === '1+2' ? 'OK' : 'UNEXPECTED');
  console.log('unknown warned: ', JSON.stringify(warn));
  console.log('pending shown:  ', JSON.stringify(shown));
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
