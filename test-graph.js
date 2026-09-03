/* Graphing: the student states what determines the curve, we solve and draw. */
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
fs.writeFileSync(path.join(HERE,'_graph.html'), src);
const URL = F('_graph.html');

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({status:200, contentType:'text/javascript', body:FAKE}));
  const errs=[]; const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  let pass=0, fail=0;
  const chk=(n,ok,d)=>{ if(ok){pass++;} else {fail++;console.log('FAIL  '+n+(d!==undefined?'  '+d:''));} };

  const p = await ctx.newPage(); watch(p);
  await p.goto(URL); await p.waitForTimeout(400);
  await p.fill('#roomInput','GRAPH'); await p.fill('#nameInput','Priya');
  await p.click('#joinStudent'); await p.waitForTimeout(600);

  /* ---- the numbers a student types ---- */
  const num = s => p.evaluate(x => { const r = window.__chalkboard.graph().evalNum(x);
                                     return r.err ? 'ERR:'+r.err : r.v; }, s);
  const near = (a,bb) => typeof a === 'number' && Math.abs(a-bb) < 1e-9;
  chk('plain numbers',      near(await num('4.5'), 4.5));
  chk('e',                  near(await num('e-3'), Math.E-3));
  chk('pi',                 near(await num('pi/2'), Math.PI/2));
  chk('natural log',        near(await num('ln3-1'), Math.log(3)-1));
  chk('roots',              near(await num('sqrt(2)'), Math.SQRT2));
  chk('powers',             near(await num('2^3'), 8));
  chk('brackets',           near(await num('2*(3+4)'), 14));
  chk('unary minus',        near(await num('-4'), -4));
  chk('a half-finished sum is refused', String(await num('2+')).startsWith('ERR'));
  chk('a word that is not a number is refused', String(await num('banana')).startsWith('ERR'));
  chk('an unclosed bracket is refused', String(await num('(2+3')).startsWith('ERR'));

  /* ---- the solver recovers the curve it was cut from ----
     Take a logarithm in a real base, compute the key features a student would
     compute, feed them back, and check both the function and the way it is
     written come back the same. */
  const round = await p.evaluate(() => {
    const G = window.__chalkboard.graph(); const NONE = G.NONEVAL;
    const out = [];
    const cases = [
      {tex:'y = \\log_{3}\\left(x + 1\\right) + 2',   base:'3',  h:-1, a:1,   k:2},
      {tex:'y = 2\\log_{2}\\left(x - 1\\right) - 3',  base:'2',  h:1,  a:2,   k:-3},
      {tex:'y = \\log\\left(x + 4\\right) + 1',       base:'10', h:-4, a:1,   k:1},
      {tex:'y = \\ln\\left(x + 3\\right) - 1',        base:'e',  h:-3, a:1,   k:-1},
      {tex:'y = -2\\ln\\left(x + 2\\right) + 5',      base:'e',  h:-2, a:-2,  k:5},
      {tex:'y = 0.5\\log_{5}\\left(x + 6\\right) - 2', base:'5', h:-6, a:0.5, k:-2}
    ];
    for(const c of cases){
      const lb = c.base === 'e' ? 1 : Math.log(Number(c.base));
      const A = c.a / lb;                       // the natural-log coefficient
      const f = x => A * Math.log(x - c.h) + c.k;
      const xint = c.h + Math.exp(-c.k / A);
      const hasY = c.h < 0;                     // is the y-axis in the domain?
      const sol = G.solveGraph({fam:'log', f:{
        va:'x = ' + c.h, base:c.base, xint:'(' + xint + ', 0)',
        yint: hasY ? '(0, ' + f(0) + ')' : NONE,
        pt:   hasY ? '' : '(' + (c.h + 4) + ', ' + f(c.h + 4) + ')'
      }});
      if(sol.err || !sol.fn){ out.push({c, err:sol.err || sol.need}); continue; }
      let worst = 0;
      for(let i = 1; i <= 40; i++){
        const x = c.h + i * 0.4;
        worst = Math.max(worst, Math.abs(sol.fn(x) - f(x)));
      }
      out.push({c, worst, tex:sol.tex});
    }
    return out;
  });
  for(const r of round){
    chk('recovers ' + r.c.tex, !r.err && r.worst < 1e-9, r.err || ('off by ' + r.worst));
    chk('and writes it as ' + r.c.tex, r.tex === r.c.tex, r.tex);
  }

  /* ---- the base decides how it is written, not what it is ---- */
  const bases = await p.evaluate(() => {
    const G = window.__chalkboard.graph(); const NONE = G.NONEVAL;
    const f = x => Math.log(x + 3) - 1;         // one curve, several bases
    const out = {};
    for(const bse of ['e', '10', '2']){
      const sol = G.solveGraph({fam:'log', f:{
        va:'x = -3', base:bse, xint:'(' + (Math.E-3) + ', 0)', yint:'(0, ' + f(0) + ')'}});
      out[bse] = {tex:sol.tex, at1:sol.fn(1)};
    }
    return out;
  });
  chk('base e is written with ln', /\\ln/.test(bases.e.tex), bases.e.tex);
  chk('base 10 is written with a bare log',
      bases['10'].tex.indexOf('\\log\\left') >= 0, bases['10'].tex);
  chk('base 2 is written with a subscript', /\\log_\{2\}/.test(bases['2'].tex), bases['2'].tex);
  chk('but it is the same curve either way',
      Math.abs(bases.e.at1 - bases['10'].at1) < 1e-12 &&
      Math.abs(bases.e.at1 - bases['2'].at1) < 1e-12);

  /* ---- a bad base ---- */
  const badBase = await p.evaluate(() => {
    const G = window.__chalkboard.graph(); const NONE = G.NONEVAL;
    const t = bse => { const r = G.solveGraph({fam:'log',
      f:{va:'x = -3', base:bse, xint:'(1,0)', yint:'(0,2)'}}); return r.err || null; };
    return {one:t('1'), neg:t('-2'), zero:t('0')};
  });
  chk('base 1 is refused', /1 cannot be the base/.test(badBase.one||''), badBase.one);
  chk('a negative base is refused', /positive/.test(badBase.neg||''), badBase.neg);
  chk('base 0 is refused', /positive/.test(badBase.zero||''), badBase.zero);

  /* ---- the student writes the notation, and is told when it is wrong ---- */
  const form = await p.evaluate(() => {
    const G = window.__chalkboard.graph(); const NONE = G.NONEVAL;
    const t = f => { const r = G.solveGraph({fam:'log',
      f:Object.assign({va:'x = -3', base:'e', xint:'(1,0)', yint:'(0,2)'}, f)});
      return r.err || r.need || null; };
    return {
      bareVA:  t({va:'-3'}),
      wrongVA: t({va:'y = -3'}),
      barePt:  t({xint:'2'}),
      xNotOn:  t({xint:'(2, 5)'}),
      yNotOn:  t({yint:'(1, 5)'})
    };
  });
  chk('an asymptote must be written as an equation',
      /write it as an equation/.test(form.bareVA||''), form.bareVA);
  chk('and an equation in x', /equation in x/.test(form.wrongVA||''), form.wrongVA);
  chk('an intercept must be written as a point',
      /write a point, in brackets/.test(form.barePt||''), form.barePt);
  chk('an x-intercept must have y = 0', /its y must be 0/.test(form.xNotOn||''), form.xNotOn);
  chk('a y-intercept must have x = 0', /its x must be 0/.test(form.yNotOn||''), form.yNotOn);

  /* ---- what it knows, and will not let a student get away with ---- */
  const bad = await p.evaluate(() => {
    const G = window.__chalkboard.graph(); const NONE = G.NONEVAL;
    const t = f => { const r = G.solveGraph({fam:'log',
      f:Object.assign({base:'e'}, f)}); return r.err || r.need || null; };
    return {
      noX:      t({va:'x = -3', xint:NONE,      yint:'(0,1)'}),
      falseNoY: t({va:'x = -3', xint:'(-0.28,0)', yint:NONE}),
      onAsym:   t({va:'x = -3', xint:'(-3,0)',    yint:'(0,1)'}),
      opposite: t({va:'x = 1',  xint:'(3,0)',     yint:NONE, pt:'(-2, 1)'}),
      junk:     t({va:'x = -3', xint:'(banana,0)', yint:'(0,1)'}),
      blank:    t({va:'x = -3'})
    };
  });
  chk('claiming no x-intercept is corrected',
      /crosses the x-axis exactly once/.test(bad.noX||''), bad.noX);
  chk('claiming no y-intercept when there is one is corrected',
      /does cross the y-axis/.test(bad.falseNoY||''), bad.falseNoY);
  chk('an intercept on the asymptote is refused',
      /asymptote/.test(bad.onAsym||''), bad.onAsym);
  chk('features on opposite sides of the asymptote are refused',
      /opposite sides/.test(bad.opposite||''), bad.opposite);
  chk('nonsense in a field is named',
      /has no value here/.test(bad.junk||''), bad.junk);
  chk('blank fields are named',
      /still to work out: x-intercept, y-intercept/.test(bad.blank||''), bad.blank);

  /* ---- a log through the origin: both intercepts are the same point ---- */
  const origin = await p.evaluate(() => {
    const G = window.__chalkboard.graph(); const NONE = G.NONEVAL;
    const f = x => 2 * Math.log(x + 1);
    const both = G.solveGraph({fam:'log',
      f:{va:'x = -1', base:'e', xint:'(0,0)', yint:'(0,0)'}});
    const plus = G.solveGraph({fam:'log',
      f:{va:'x = -1', base:'e', xint:'(0,0)', yint:'(0,0)', pt:'(3,'+f(3)+')'}});
    return {both: both.need || both.err || 'solved',
            plus: !plus.err && !plus.need && Math.abs(plus.fn(1) - f(1)) < 1e-9};
  });
  chk('coincident intercepts are explained, not just refused',
      /same point/.test(origin.both), origin.both);
  chk('and a third feature settles it', origin.plus, JSON.stringify(origin));

  /* ---- an extra feature is checked, not ignored ---- */
  const spare = await p.evaluate(() => {
    const G = window.__chalkboard.graph(); const NONE = G.NONEVAL;
    const f = x => Math.log(x + 3) - 1;
    const base = {va:'x = -3', base:'e', xint:'('+(Math.E-3)+',0)', yint:'(0,'+f(0)+')'};
    const good = G.solveGraph({fam:'log', f:Object.assign({}, base, {pt:'(2,'+f(2)+')'})});
    const wrong = G.solveGraph({fam:'log', f:Object.assign({}, base, {pt:'(2, 5)'})});
    return {good: !good.err && !!good.fn, wrong: wrong.err || null};
  });
  chk('an extra point that agrees is accepted', spare.good);
  chk('an extra point that disagrees is called out',
      /does not sit on the curve/.test(spare.wrong||''), spare.wrong);

  /* ---- a reflected logarithm, y = ln(3 − x) ---- */
  const refl = await p.evaluate(() => {
    const G = window.__chalkboard.graph(); const NONE = G.NONEVAL;
    const f = x => Math.log(3 - x);
    const sol = G.solveGraph({fam:'log',
      f:{va:'x = 3', base:'e', xint:'(2,0)', yint:'(0,'+f(0)+')'}});
    return sol.err ? {err:sol.err} : {at0:sol.fn(0), at2:sol.fn(2), right:sol.fn(4)};
  });
  chk('a logarithm reflected leftwards works',
      !refl.err && Math.abs(refl.at0 - Math.log(3)) < 1e-9 && Math.abs(refl.at2) < 1e-9,
      JSON.stringify(refl));
  chk('and it stops at its asymptote', !refl.err && !isFinite(refl.right), JSON.stringify(refl));

  /* ---- on the board: real maths fields, features first, curve on request ---- */
  await p.click('#addGraph'); await p.waitForTimeout(400);
  const msg = () => p.evaluate(()=>{const m=document.querySelector('.gmsg');return m?m.textContent:'';});
  const btnOff = () => p.evaluate(()=>document.querySelector('.gbtn').disabled);
  const labels = () => p.evaluate(()=>[...document.querySelectorAll('.gitem b')].map(e=>e.textContent));
  const boxes  = () => p.evaluate(()=>[...document.querySelectorAll('.gbox')].map(e=>e.dataset.gk));
  const at     = () => p.evaluate(()=>{const b=document.querySelector('.gbox.here');return b?b.dataset.gk:null;});
  const stored = () => p.evaluate(()=>JSON.parse(window.__chalkboard.currentLines()[1].slice(4)).f);
  const shows  = k => p.evaluate(x=>{
    const b=[...document.querySelectorAll('.gbox')].find(e=>e.dataset.gk===x);
    return b ? b.innerText.replace(/\s+/g,'') : null; }, k);
  const clickNone = k => p.evaluate(x=>{
    const rows=[...document.querySelectorAll('.gitem')];
    const row=rows.find(r=>[...r.querySelectorAll('.gbox')].some(b=>b.dataset.gk===x));
    row.querySelector('.gnone:not(.spacer)').click(); }, k);
  const ink = (sel, min) => p.evaluate(([s,m])=>{
    const c = document.querySelector(s); if(!c) return false;
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let n=0; for(let i=3;i<d.length;i+=4) if(d[i] > 8) n++;
    return n > m;
  }, [sel, min]);

  chk('a graph line is added with a maths line under it',
      (await p.evaluate(()=>window.__chalkboard.currentLines().length)) === 3);
  chk('the fields are the key features, written out',
      JSON.stringify(await labels()) === JSON.stringify([
        'equation of vertical asymptote:', 'base of the logarithm:',
        'x-intercept:', 'y-intercept:']),
      JSON.stringify(await labels()));
  chk('the extra point is not asked for up front',
      !(await labels()).some(l => /another point/.test(l)));
  chk('no example is put inside the boxes',
      await p.evaluate(()=>[...document.querySelectorAll('.gbox')].every(b=>!b.textContent.trim())));
  chk('the caret starts in the first box', (await at()) === 'va');
  chk('and it will not graph yet', await btnOff());

  /* ---- typing goes into the box as mathematics ---- */
  await p.keyboard.type('x=-3', {delay:12}); await p.waitForTimeout(300);
  chk('typing lands in the box', (await stored()).va === 'x=-3', JSON.stringify(await stored()));
  chk('and is typeset, not left as text', (await shows('va')) === 'x=−3', await shows('va'));

  await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  chk('Tab moves to the next feature', (await at()) === 'base');
  await p.keyboard.type('e', {delay:12}); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  chk('and on to the x-intercept', (await at()) === 'xint');

  await p.keyboard.type('(e-3,0)', {delay:12}); await p.waitForTimeout(300);
  chk('a point is typeset with real brackets',
      (await shows('xint')) === '(e−3,0)', await shows('xint'));
  chk('one intercept alone is not enough', await btnOff());

  await p.keyboard.press('Tab'); await p.keyboard.type('(0,ln3-1)', {delay:12});
  await p.waitForTimeout(400);
  chk('with both intercepts it offers to draw', !(await btnOff()));
  chk('the equation is not shown before graphing',
      (await p.evaluate(()=>document.querySelectorAll('.geq').length)) === 0);

  /* ---- a fraction in a feature box ---- */
  await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  await p.evaluate(()=>{
    const b=[...document.querySelectorAll('.gbox')].find(e=>e.dataset.gk==='base');
    b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await p.waitForTimeout(200);
  await p.keyboard.press('Control+a'); await p.keyboard.press('Backspace');
  await p.keyboard.type('1/2', {delay:12}); await p.waitForTimeout(300);
  chk('a fraction can be typed into a feature box',
      (await stored()).base === '\\frac{1}{2}', JSON.stringify(await stored()));
  chk('and it is read as a number', /base|features are enough/.test(await msg()), await msg());
  // clicking the box puts the caret back at its root, which is where a
  // select-all has to start — inside the fraction it would only clear that
  await p.evaluate(()=>{
    const b=[...document.querySelectorAll('.gbox')].find(e=>e.dataset.gk==='base');
    b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await p.waitForTimeout(200);
  await p.keyboard.press('Control+a'); await p.keyboard.press('Backspace');
  await p.keyboard.type('e', {delay:12}); await p.waitForTimeout(300);
  chk('and the box can be cleared and retyped',
      (await stored()).base === 'e', JSON.stringify(await stored()));

  await p.click('.gbtn'); await p.waitForTimeout(500);
  chk('graphing shows the equation',
      (await p.evaluate(()=>document.querySelector('.geq span').innerText)).replace(/\s/g,'')
        === 'y=ln(x+3)−1',
      await p.evaluate(()=>{const g=document.querySelector('.geq span');return g?g.innerText:'(none)';}));
  chk('and the curve is on the canvas', await ink('.board canvas.gplot', 2000));
  chk('the button says it is done',
      (await p.evaluate(()=>document.querySelector('.gbtn').textContent)) === 'Graphed');

  /* ---- the "none" switch ---- */
  await clickNone('yint'); await p.waitForTimeout(400);
  chk('switching a feature to none shows it as none',
      (await shows('yint')).toLowerCase() === 'none', await shows('yint'));
  chk('and the curve comes back down',
      (await p.evaluate(()=>document.querySelectorAll('.geq').length)) === 0);
  chk('a wrong "none" is corrected here too',
      /does cross the y-axis/.test(await msg()), await msg());
  await clickNone('yint'); await p.waitForTimeout(400);
  chk('switching it back leaves an empty box to type in',
      (await shows('yint')) === '' && (await boxes()).includes('yint'), await shows('yint'));
  chk('and it asks for the y-intercept again',
      /still to work out: y-intercept/.test(await msg()), await msg());

  await p.evaluate(()=>{
    const b=[...document.querySelectorAll('.gbox')].find(e=>e.dataset.gk==='yint');
    b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await p.waitForTimeout(250);
  await p.keyboard.type('(0,ln3-1)', {delay:12}); await p.waitForTimeout(300);
  await p.click('.gbtn'); await p.waitForTimeout(400);
  chk('and it graphs again',
      (await p.evaluate(()=>document.querySelectorAll('.geq').length)) === 1);

  /* ---- it travels ---- */
  const enc = await p.evaluate(()=>window.__chalkboard.currentLines()[1]);
  chk('a graph line encodes as one string', enc.startsWith('%%G '), enc);
  chk('carrying the features and that it was graphed',
      enc.includes('e-3') && enc.includes('"on":true'), enc);

  await p.evaluate(()=>window.__chalkboard.loadLines(window.__chalkboard.currentLines()));
  await p.waitForTimeout(400);
  chk('and comes back the same after a round trip',
      (await p.evaluate(()=>window.__chalkboard.currentLines()[1])) === enc,
      await p.evaluate(()=>window.__chalkboard.currentLines()[1]));
  chk('with the curve still drawn', await ink('.board canvas.gplot', 2000));

  /* ---- and reaches the teacher ---- */
  const t = await ctx.newPage(); watch(t);
  await t.goto(URL); await t.waitForTimeout(500);
  await t.fill('#roomInput','GRAPH');
  await t.click('#joinTeacher'); await t.waitForTimeout(250);
  await t.fill('#tEmail','mr@chalkline.test'); await t.fill('#tPass','correct-horse');
  await t.click('#tSignIn'); await t.waitForTimeout(1400);
  chk('the graph reaches the wall',
      (await t.evaluate(()=>document.querySelectorAll('.tile canvas.gplot').length)) === 1,
      await t.evaluate(()=>document.querySelectorAll('.tile').length + ' tiles'));
  await t.waitForTimeout(500);
  chk('and is drawn in the tile', await t.evaluate(()=>{
    const c = document.querySelector('.tile canvas.gplot');
    if(!c) return false;
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let n=0; for(let i=3;i<d.length;i+=4) if(d[i] > 8) n++;
    return n > 300;
  }));

  chk('nothing threw', errs.length === 0, errs.join(' | '));
  console.log(`\ngraphing: ${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
