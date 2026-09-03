const { chromium } = require('playwright');
const path = require('path');
const HERE = __dirname;
const F = n => 'file://' + path.join(HERE, n);
/* Playwright uses its own browser unless CHROME points somewhere else. */
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const fs = require('fs');
/* ---- generator: emit LaTeX exactly as the serializer would ---- */
let seed = 20260829;
function rnd(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick(a){ return a[Math.floor(rnd() * a.length) % a.length]; }

const ATOMS  = ['x','y','a','b','n','t','2','3','7','0'];
const OPS    = ['+','-','\\pm','\\cdot','\\times','\\div'];
const RELS   = ['=','<','>','\\le','\\ge','\\ne','\\approx','\\to'];
const FUNCS  = ['\\sin','\\cos','\\tan','\\log','\\ln','\\sec'];
const SYMS   = ['\\pi','\\theta','\\infty','\\partial',"'"];
const DELIMS = [['(',')'],['[',']'],['|','|']];

// returns {tex, kind} where kind decides whether a following fn needs a space
function gen(depth){
  const r = rnd();
  if(depth <= 0 || r < 0.34) return {tex: pick(ATOMS), kind: 'c'};
  if(r < 0.44) return {tex: `\\frac{${seq(depth-1)}}{${seq(depth-1)}}`, kind: 'x'};
  if(r < 0.52) return {tex: `\\sqrt{${seq(depth-1)}}`, kind: 'x'};
  if(r < 0.57) return {tex: `\\sqrt[${seq(depth-1)}]{${seq(depth-1)}}`, kind: 'x'};
  if(r < 0.66){ const d = pick(DELIMS); return {tex: `\\left${d[0]}${seq(depth-1)}\\right${d[1]}`, kind: 'x'}; }
  if(r < 0.72) return {tex: pick(SYMS), kind: 'sym'};
  if(r < 0.78) return {tex: pick(FUNCS), kind: 'fn'};
  if(r < 0.83){
    const b = pick(['\\sum','\\prod','\\int']);
    let s = b;
    if(rnd() < 0.7) s += `_{${seq(depth-1)}}`;
    if(rnd() < 0.7) s += `^{${seq(depth-1)}}`;
    return {tex: s, kind: 'x'};
  }
  if(r < 0.87) return {tex: `\\lim_{${seq(depth-1)}}`, kind: 'x'};
  if(r < 0.93) return {tex: `${pick(ATOMS)}^{${seq(depth-1)}}`, kind: 'x'};
  return {tex: `${pick(ATOMS)}_{${seq(depth-1)}}`, kind: 'x'};
}

function seq(depth){
  const n = 1 + Math.floor(rnd() * 3);
  let out = '';
  // same rule the serializer uses: a control word running into a letter
  // needs one space between them ("\\sin x", not "\\sinx")
  const add = t => {
    if(/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(t)) out += ' ';
    out += t;
  };
  for(let i = 0; i < n; i++){
    if(i > 0 && rnd() < 0.5) add(pick(rnd() < 0.75 ? OPS : RELS));
    add(gen(depth).tex);
  }
  return out;
}

/* ---- corpus: what the editor itself produces, and real textbook LaTeX ---- */
const CANONICAL = [
  'x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}',
  '\\sin^{2}\\left(\\theta\\right)+\\cos^{2}\\left(\\theta\\right)=1',
  '\\log_{2}\\left(\\frac{x}{8}\\right)=\\sqrt[3]{27}',
  '\\left|2x-5\\right|\\le11',
  '\\begin{cases}3x+2y=12 \\\\ x-y=1\\end{cases}',
  '\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}',
  '\\theta=90^\\circ',
  '\\frac{d}{dx}\\left(x^{3}-2x\\right)',
  '\\frac{d^{2}}{dx^{2}}',
  '\\frac{\\partial}{\\partial x}',
  '\\int\\left(3x^{2}-1\\right)dx',
  '\\int_{0}^{1}x^{2}\\,dx',
  '\\int_{0}^{\\pi}\\sin xdx',
  '\\sum_{n=1}^{12}3n-2',
  '\\prod_{k=1}^{n}k',
  '\\lim_{x\\to0}\\frac{\\sin x}{x}',
  "f'\\left(x\\right)=2x",
  'a_{n}=a_{1}+\\left(n-1\\right)d',
  '\\sqrt[3]{\\frac{x+1}{x-2}}',
];

// hand-written LaTeX a teacher would actually paste; normalization is expected
const REALWORLD = [
  ['\\int_0^1 x^2 \\, dx',            '\\int_{0}^{1}x^{2}\\,dx'],
  ['\\frac{d}{dx}(x^3 - 2x)',         '\\frac{d}{dx}\\left(x^{3}-2x\\right)'],
  ['\\lim_{x \\to 0} \\frac{\\sin x}{x}', '\\lim_{x\\to0}\\frac{\\sin x}{x}'],
  ['\\dfrac{1}{2}',                   '\\frac{1}{2}'],
  ['x^2 + y^2 = r^2',                 'x^{2}+y^{2}=r^{2}'],
  ['\\sqrt{b^2-4ac}',                 '\\sqrt{b^{2}-4ac}'],
  ['|x - 3| \\geq 5',                 '\\left|x-3\\right|\\ge5'],
  ['\\sum_{i=1}^{n} i^2',             '\\sum_{i=1}^{n}i^{2}'],
  ['\\int_{a}^{b} f(x)\\,dx',         '\\int_{a}^{b}f\\left(x\\right)\\,dx'],
];

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(F('chalkline-board.html'));
  await page.waitForTimeout(300);
  await page.fill('#roomInput','TEST'); await page.fill('#nameInput','Tester');
  await page.click('#joinStudent');
  await page.waitForTimeout(350);

  const parse = s => page.evaluate(x => window.__chalkline.parse(x), s);

  let fails = [];

  // 1. canonical round trip
  for(const s of CANONICAL){
    const r = await parse(s);
    if(r.tex !== s) fails.push({ set:'canonical', in:s, out:r.tex });
    if(r.warnings.length) fails.push({ set:'canonical-warn', in:s, out:r.warnings.join(',') });
  }

  // 2. real-world normalization
  for(const [src, want] of REALWORLD){
    const r = await parse(src);
    if(r.tex !== want) fails.push({ set:'realworld', in:src, out:r.tex, want });
  }

  // 3. generated: the serializer's output must be a FIXED POINT of parse.
  //    parse(s) -> t1 -> parse(t1) -> t2, and t1 must equal t2 with no warnings.
  //    This checks serializer and parser against each other without the test
  //    needing to reimplement the spacing rules.
  let gens = 0, genFails = 0;
  const cases = [];
  for(let i = 0; i < 500; i++) cases.push(seq(3));
  const results = await page.evaluate(list => list.map(s => {
    const r1 = window.__chalkline.parse(s);
    const r2 = window.__chalkline.parse(r1.tex);
    return { s, t1: r1.tex, t2: r2.tex, w: r1.warnings.concat(r2.warnings) };
  }), cases);
  for(const r of results){
    gens++;
    const bad = r.t1 !== r.t2 || r.w.length;
    if(bad){
      genFails++;
      if(fails.filter(f => f.set === 'generated').length < 5)
        fails.push({ set:'generated' + (r.w.length ? ' (warned: ' + r.w[0] + ')' : ''),
                     in:r.t1, out:r.t2 });
    }
  }

  console.log(`\ncanonical: ${CANONICAL.length}  realworld: ${REALWORLD.length}  generated: ${gens} (${genFails} failed)`);
  if(fails.length){
    console.log('\n=== FAILURES ===');
    for(const f of fails.slice(0, 14)){
      console.log(`[${f.set}]`);
      console.log(`   in:   ${f.in}`);
      console.log(`   out:  ${f.out}`);
      if(f.want) console.log(`   want: ${f.want}`);
    }
    console.log(`\ntotal failures: ${fails.length}`);
  } else {
    console.log('\nALL ROUND-TRIPS CLEAN');
  }
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
