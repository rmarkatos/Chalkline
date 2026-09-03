const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};

const CASES = [
  ['words then math',            '$Since $b^2',              '\\text{Since }b^{2}'],
  ['math inside a sentence',     '$Since $b^2 -4ac$ is negative, no real roots.',
                                 '\\text{Since }b^{2}-4ac\\text{ is negative, no real roots.}'],
  ['spaces preserved',           '$two  spaces$',            '\\text{two  spaces}'],
  ['fraction after words',       '$area is $1/2',            '\\text{area is }\\frac{1}{2}'],
  ['digits literal in words',    '$Step 2:$',                '\\text{Step 2:}'],
  ['slash literal in words',     '$and/or$',                 '\\text{and/or}'],
  ['caret literal in words',     '$x^2 means$',              '\\text{x^2 means}'],
  ['back to math',               '$let $x=3$ so$',           '\\text{let }x=3\\text{ so}'],
  ['sentence after exponent',    '$so $x^2$ is even$',       '\\text{so }x^{2}\\text{ is even}'],
  ['sentence after subscript',   '$term $a_n$ grows$',       '\\text{term }a_{n}\\text{ grows}'],
  ['trailing sentence',          '2x+1$ is odd$',            '2x+1\\text{ is odd}'],
  ['sqrt after words',           '$check $sqrt16',           '\\text{check }\\sqrt{16}'],
  ['punctuation in words',       "$Don't forget!$",          "\\text{Don't forget!}"],
  ['words, math, words, math',   '$a $1$ b $2',              '\\text{a }1\\text{ b }2'],
];

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport:{width:1280,height:900} });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(F('chalkline-board.html'));
  await p.waitForTimeout(300);
  await p.fill('#roomInput','TEST'); await p.fill('#nameInput','Tester');
  await p.click('#joinStudent');
  const tex = () => p.evaluate(() => window.__chalkline.tex());
  const reset = async () => { await p.click('#clearAll'); await p.focus('#hidden'); };

  let pass = 0; const fails = [];
  for(const [name, typed, want] of CASES){
    await reset(); await p.keyboard.type(typed, {delay:4});
    const got = (await tex()).trim();
    if(got === want) pass++; else fails.push({name, typed, got, want});
  }

  // words inside a fraction, via the palette template
  await reset(); await p.click('.pbtn[data-id="frac"]');
  await p.keyboard.type('$rise$'); await p.keyboard.press('Tab'); await p.keyboard.type('$run$');
  let got = (await tex()).trim();
  if(got === '\\frac{\\text{rise}}{\\text{run}}') pass++;
  else fails.push({name:'words in a fraction', typed:'(palette)', got, want:'\\frac{\\text{rise}}{\\text{run}}'});

  // backspace walks out of the word one letter at a time
  await reset(); await p.keyboard.type('$word$x=1');
  for(let i=0;i<3;i++) await p.keyboard.press('Backspace');
  got = (await tex()).trim();
  if(got === '\\text{word}') pass++;
  else fails.push({name:'backspace to the boundary', typed:'$word$x=1 + 3×BS', got, want:'\\text{word}'});

  // round trip through the parser, spaces intact
  const rt = await p.evaluate(() => window.__chalkline.parse(
    '\\text{Since }b^{2}-4ac\\text{ is negative, no real roots.}'));
  if(rt.tex === '\\text{Since }b^{2}-4ac\\text{ is negative, no real roots.}' && !rt.warnings.length) pass++;
  else fails.push({name:'round trip', typed:'(parse)', got:rt.tex, want:'identical'});

  // paste a mixed line straight onto the board
  await reset();
  await p.click('#importBtn');
  await p.fill('#importText', '\\text{The discriminant }b^{2}-4ac\\text{ decides the number of roots.}');
  await p.click('#importGo'); await p.waitForTimeout(150);
  got = (await tex()).trim();
  if(got === '\\text{The discriminant }b^{2}-4ac\\text{ decides the number of roots.}') pass++;
  else fails.push({name:'paste mixed line', typed:'(import)', got, want:'identical'});

  const total = CASES.length + 4;
  console.log(`\ninline text: ${pass}/${total} passed`);
  for(const f of fails){
    console.log(`  FAIL  ${f.name}`);
    console.log(`     typed: ${f.typed}`);
    console.log(`     got:   ${f.got}`);
    console.log(`     want:  ${f.want}`);
  }
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
