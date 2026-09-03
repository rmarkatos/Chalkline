/* Brackets are typed as characters and pair only with their own partner;
   the rebuilt palette rows produce the right LaTeX; the panel sits left. */
const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const URL = F('chalkline-board.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport:{width:1400,height:1000} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(300);
  await p.fill('#roomInput','TEST'); await p.fill('#nameInput','Tester');
  await p.click('#joinStudent'); await p.waitForTimeout(350);

  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;} else {fail++;console.log('FAIL  '+n+(d!==undefined?'\n      '+d:''));} };
  const tex = () => p.evaluate(()=>window.__chalkline.tex().trim());
  const reset = async () => { await p.click('#clearAll'); await p.focus('#hidden'); };
  const T = async (name, keys, want) => {
    await reset();
    await p.keyboard.type(keys, {delay:4});
    const got = await tex();
    chk(name, got === want, 'got:  ' + got + '\n      want: ' + want);
  };

  /* ---- an opener is only a character until its partner turns up ---- */
  await T('a lone ( stays a lone (',        '(',      '(');
  await T('a lone [ stays a lone [',        '[',      '[');
  await T('a lone { stays a lone {',        '{',      '\\{');
  await T('a lone ) stays a lone )',        ')',      ')');
  await T('an opener with work after it',   '(2x+1',  '(2x+1');

  /* ---- closing the pair makes a group ---- */
  await T('( then ) makes an empty group',  '()',     '\\left(\\right)');
  await T('brackets group too',             '[x]',    '\\left[x\\right]');
  await T('braces group too',               '{x}',    '\\left\\{x\\right\\}');
  await T('a filled pair',                  '(2x+1)', '\\left(2x+1\\right)');

  /* ---- mismatched brackets are left exactly as typed ---- */
  await T('[ ) is not quietly rewritten',   '[)',     '[)');
  await T('( ] is not quietly rewritten',   '(]',     '(]');
  await T('{ ) is not quietly rewritten',   '{)',     '\\{)');
  await T('a mismatch inside real work',    '3[x+1)', '3[x+1)');

  /* ---- where the caret lands ---- */
  await T('an empty pair leaves the caret inside', '()5',   '\\left(5\\right)');
  await T('a filled pair leaves the caret after',  '(x)+1', '\\left(x\\right)+1');
  await T('nesting still works',                   '(2(x+1))', '\\left(2\\left(x+1\\right)\\right)');

  /* ---- the palette ---- */
  const click = async id => { await reset(); await p.click('.pbtn[data-id="'+id+'"]'); };
  const B = async (id, want) => {
    await click(id);
    const got = await tex();
    chk('button ' + id, got === want, 'got:  ' + got + '\n      want: ' + want);
  };
  await B('div',   '\\div');
  await B('circ',  '\\circ');
  await B('vbar',  '|');
  await B('cap',   '\\cap');
  await B('Delta', '\\Delta');
  await B('to',    '\\to');
  await B('plus',  '+');
  await B('minus', '-');
  await B('evalAt', '\\big|_{}');
  await B('evalAB', '\\big|_{}^{}');

  await click('evalAt'); await p.keyboard.type('2');
  chk('the bar takes a value below', (await tex()) === '\\big|_{2}', await tex());

  await click('evalAB');
  await p.keyboard.type('0'); await p.keyboard.press('Tab'); await p.keyboard.type('1');
  chk('the bar takes both limits', (await tex()) === '\\big|_{0}^{1}', await tex());

  await reset();
  await p.click('.pbtn[data-id="intDef"]');
  await p.keyboard.type('0'); await p.keyboard.press('Tab'); await p.keyboard.type('1');
  await p.keyboard.press('Tab');
  await p.keyboard.type('x^2'); await p.keyboard.press('ArrowRight');
  await p.click('.pbtn[data-id="evalAB"]');
  await p.keyboard.type('a'); await p.keyboard.press('Tab'); await p.keyboard.type('b');
  chk('an integral and an evaluation bar together',
      (await tex()) === '\\int_{0}^{1}x^{2}\\big|_{a}^{b}', await tex());

  /* ---- the bar survives a round trip through the parser ---- */
  for(const src of ['\\big|_{0}^{1}', '\\big|_{a}', 'F(x)\\big|_{0}^{2}']){
    const r = await p.evaluate(x => window.__chalkline.parse(x), src);
    const want = src.replace('F(x)', 'F\\left(x\\right)');
    chk('round trip ' + src, r.tex === want && !r.warnings.length,
        'got:  ' + r.tex + '  warnings: ' + r.warnings.join(','));
  }

  /* ---- panels ---- */
  const labels = await p.evaluate(()=>[...document.querySelectorAll('.pgroup>.lbl')].map(e=>e.textContent));
  chk('the operator panel is named Operators', labels.includes('Operators'), labels.join(' | '));
  chk('number sets panel renamed', labels.includes('Number sets and symbols'), labels.join(' | '));

  const rowOf = async id => (await p.evaluate(i =>
      Math.round(document.querySelector('.pbtn[data-id="'+i+'"]').getBoundingClientRect().top), id));
  const ops = {};
  for(const id of ['plus','minus','cdot','div','le','ge','ne','approx','pm','circ','implies','vbar'])
    ops[id] = await rowOf(id);
  chk('operators row 1 is + - · ÷',
      ops.plus === ops.minus && ops.minus === ops.cdot && ops.cdot === ops.div, JSON.stringify(ops));
  chk('operators row 2 is the comparisons',
      ops.le === ops.approx && ops.le > ops.plus, JSON.stringify(ops));
  chk('operators row 3 is ± ∘ ⇒ |',
      ops.pm === ops.vbar && ops.pm > ops.le, JSON.stringify(ops));

  const cal = {};
  for(const id of ['ddx','d2gen','inf','to','lim','sum','intInd','intDef','evalAt','evalAB'])
    cal[id] = await rowOf(id);
  chk('calculus row 2 is ∞ → lim ∑',
      cal.inf === cal.to && cal.to === cal.lim && cal.lim === cal.sum && cal.inf > cal.ddx,
      JSON.stringify(cal));
  chk('calculus row 3 is the integrals and the bars',
      cal.intInd === cal.intDef && cal.intDef === cal.evalAt && cal.evalAt === cal.evalAB
      && cal.intInd > cal.inf, JSON.stringify(cal));

  const side = await p.evaluate(()=>({
    palette: Math.round(document.querySelector('.palette').getBoundingClientRect().left),
    board:   Math.round(document.querySelector('.board').getBoundingClientRect().left)
  }));
  chk('the panel sits to the left of the board', side.palette < side.board, JSON.stringify(side));


  /* ---- a fraction in an exponent has to sit up in the exponent ---- */
  const geom = async (src) => {
    await reset();
    await p.click('#importBtn');
    await p.fill('#importText', src);
    await p.click('#importGo'); await p.waitForTimeout(250);
    return p.evaluate(() => {
      const r = e => { const b = e.getBoundingClientRect();
                       return {top:b.top, bot:b.bottom, h:b.height}; };
      const base = [...document.querySelectorAll('.board .at, .board .dg')][0];
      const sc = document.querySelector('.board .sup, .board .sub');
      return {base:r(base), script:r(sc), cls:sc.className};
    });
  };

  let g = await geom('x^{\\frac{2}{3}}');
  chk('a fraction exponent is marked tall', /\btall\b/.test(g.cls), g.cls);
  chk('a fraction exponent sits above the middle of the base',
      g.script.bot < g.base.bot - g.base.h * 0.35,
      'script bottom ' + Math.round(g.script.bot) + ' vs base ' + Math.round(g.base.bot));
  chk('and does not float off the top of the line',
      g.script.top > g.base.top - g.base.h * 2.2,
      'script top ' + Math.round(g.script.top) + ' vs base top ' + Math.round(g.base.top));
  // The honest test: the gap between base and exponent is measurably bigger
  // than it would be without the lift. Absolute positions are no use — raising
  // the script grows the line box, so the base moves instead.
  const lift = await p.evaluate(() => {
    const sc = document.querySelector('.board .sup');
    const at = [...document.querySelectorAll('.board .at, .board .dg')][0];
    const gap = () => at.getBoundingClientRect().bottom - sc.getBoundingClientRect().bottom;
    const withLift = gap();
    sc.classList.remove('tall');
    const without = gap();
    sc.classList.add('tall');
    return withLift - without;
  });
  chk('the lift is what raised it', lift > 8, 'lifted by ' + Math.round(lift) + 'px');

  g = await geom('x^{2}');
  chk('a plain exponent is left as it was', !/\btall\b/.test(g.cls), g.cls);
  chk('a plain exponent still sits where it did',
      g.script.bot < g.base.bot && g.script.bot > g.base.bot - g.base.h * 0.6,
      'script bottom ' + Math.round(g.script.bot) + ' vs base ' + Math.round(g.base.bot));

  g = await geom('e^{\\sqrt{x}}');
  chk('a radical exponent is lifted too', /\btall\b/.test(g.cls), g.cls);

  g = await geom('a_{\\frac{1}{2}}');
  chk('a fraction subscript is marked tall', /\btall\b/.test(g.cls), g.cls);
  chk('a fraction subscript drops below the base',
      g.script.top > g.base.top + g.base.h * 0.45,
      'script top ' + Math.round(g.script.top) + ' vs base top ' + Math.round(g.base.top));

  await reset();


  /* ---- the space bar puts in a space, wherever you are ---- */
  await T('a space between terms',      '2x + 3',      '2x~+~3');
  await T('a space inside a radical',   'sqrt2 +1',    '\\sqrt{2~+1}');
  await T('a space leaves an exponent', 'x^n +1',       'x^{n}+1');
  await T('a space at the end is safe', 'x ',          'x~');
  await T('two spaces are two spaces',  'a  b',        'a~~b');
  await T('a space spends itself finishing a \\command', '\\alpha +1', '\\alpha+1');
  await T('and does not break \\sin x',  '\\sin x+1',   '\\sin x+1');

  chk('a trailing space leaves no dangling backslash',
      !/\\\\$/.test(await tex()), await tex());

  for(const src of ['2x~+~3', 'x~', '\\sqrt{2~+1}']){
    const r = await p.evaluate(x => window.__chalkline.parse(x), src);
    chk('a space survives the round trip: ' + src,
        r.tex === src && !r.warnings.length, r.tex + ' ' + r.warnings.join(','));
  }
  // LaTeX pasted with a real control space means the same thing
  const cs = await p.evaluate(() => window.__chalkline.parse('a\\ b'));
  chk('pasted "\\ " is read as a space', cs.tex === 'a~b', cs.tex);


  /* ---- the box stays until you leave it ---- */
  const boxes = () => p.evaluate(() =>
    [...document.querySelectorAll('.board .ml.filling')].map(e => e.textContent));

  await reset(); await p.keyboard.type('2x', {delay:5});
  chk('the line itself is never boxed', (await boxes()).length === 0, JSON.stringify(await boxes()));

  await reset(); await p.keyboard.type('x^', {delay:5});
  chk('an empty exponent shows its box', (await boxes()).length === 0 ||
      (await p.evaluate(()=>!!document.querySelector('.board .ph.active'))));

  await p.keyboard.type('2', {delay:5});
  let bx = await boxes();
  chk('the box stays once there is something in it', bx.length === 1, JSON.stringify(bx));
  chk('and it is the exponent that is boxed', bx[0] === '2', JSON.stringify(bx));

  await p.keyboard.type('n+1', {delay:5});
  bx = await boxes();
  chk('it grows with what is typed', bx.length === 1 && bx[0] === '2n+1', JSON.stringify(bx));

  await p.keyboard.press('ArrowRight');
  chk('and goes when the exponent is left', (await boxes()).length === 0, JSON.stringify(await boxes()));

  await reset(); await p.keyboard.type('1/2', {delay:5});
  bx = await boxes();
  chk('a denominator is boxed while it is being typed',
      bx.length === 1 && bx[0] === '2', JSON.stringify(bx));

  await reset(); await p.keyboard.type('sqrtx+1', {delay:5});
  bx = await boxes();
  chk('so is the inside of a radical', bx.length === 1 && bx[0] === 'x+1', JSON.stringify(bx));

  await reset();
  await p.click('.pbtn[data-id="intDef"]');
  await p.keyboard.type('0', {delay:5});
  bx = await boxes();
  chk('so is an integral bound', bx.length === 1 && bx[0] === '0', JSON.stringify(bx));
  await p.keyboard.press('Tab'); await p.keyboard.type('1', {delay:5});
  bx = await boxes();
  chk('Tab moves the box to the next bound', bx.length === 1 && bx[0] === '1', JSON.stringify(bx));

  await reset();
  await p.click('.pbtn[data-id="evalAB"]');
  await p.keyboard.type('a', {delay:5});
  bx = await boxes();
  chk('so is a limit on the evaluation bar', bx.length === 1 && bx[0] === 'a', JSON.stringify(bx));

  chk('only ever one box at a time',
      (await p.evaluate(()=>document.querySelectorAll('.board .ml.filling').length)) <= 1);

  await reset();

  chk('nothing threw', errs.length === 0, errs.join(' | '));



  await p.screenshot({path: path.join(HERE,'shot-newpalette.png')});
  console.log(`\ndelimiters + palette: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
