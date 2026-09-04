/* Does the page actually start?

   CLAUDE.md has warned about this since the beginning: render() and boot()
   run during start-up, long before the later sections of the file are
   reached, so anything they touch has to be declared at the top. A `let`
   that has not been reached yet throws

       Cannot access 'X' before initialization

   and the page comes up blank, or with an error banner and no way in. That
   has now happened five times, most recently with accountsReady — which
   reached the live site, because nothing was watching for it.

   Nothing else here can catch it. Every other suite drives
   chalkline-board.html, where the settings are empty and the accounts code
   never runs. So this one builds a copy WITH settings filled in and loads
   that, which is the only way the later sections are exercised at all.

   It does not sign anybody in. It only asks: did the script get to the end,
   and did anything explode on the way?                                    */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const HERE = __dirname;
const REAL = path.join(HERE, 'chalkline-board.html');
const TEMP = path.join(HERE, '_boot.html');

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  if (ok) pass++;
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};

/* The settings the real site has. Deliberately not Ryan's: this must never
   reach the real Clerk or the real database, and the point is only to make
   the accounts branch run at all. */
const FAKE_SUPABASE = `window.CHALKLINE_SUPABASE = {
  url:             "https://example.supabase.co",
  publishableKey:  "sb_publishable_not_a_real_key"
};`;
const FAKE_CLERK = `window.CHALKLINE_CLERK = {
  publishableKey:  "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk"
};`;

(async () => {
  let page = fs.readFileSync(REAL, 'utf8');

  const blankSupa = `window.CHALKLINE_SUPABASE = {\n  url:             "",\n  publishableKey:  ""\n};`;
  const blankClerk = `window.CHALKLINE_CLERK = {\n  publishableKey:  ""\n};`;
  chk('the built page has the settings blocks this test fills in',
      page.includes(blankSupa) && page.includes(blankClerk),
      'build.py or app.html changed shape — update test-boot.js to match');
  page = page.replace(blankSupa, FAKE_SUPABASE).replace(blankClerk, FAKE_CLERK);
  fs.writeFileSync(TEMP, page);

  const browser = await chromium.launch();
  const p = await browser.newPage();

  const errors = [];
  p.on('pageerror', e => errors.push(String(e.message).split('\n')[0]));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // the fake keys point nowhere, so let the network fail fast and quietly
  await p.route('**://*.clerk.accounts.dev/**', r => r.abort());
  await p.route('**://*.supabase.co/**', r => r.abort());
  await p.route('**://cdn.jsdelivr.net/**', r => r.abort());

  await p.goto('file://' + TEMP);
  await p.waitForTimeout(1200);

  /* The one that matters. A binding used before its declaration is reached
     is always this message, whatever the variable is called.

     Look in two places, and the second is the one with teeth. start-up wraps
     sign-in in a try/catch so a student sees a sentence rather than nothing —
     which also means the browser never reports the failure as a page error.
     The first version of this test only watched for page errors and passed
     happily against the exact bug that reached the live site. The app puts
     what went wrong on the screen, so read it off the screen. */
  const shown = await p.evaluate(() => document.body.innerText || '');
  const tdz = errors.filter(e => /before initialization/i.test(e));
  const tdzShown = /before initialization/i.test(shown);
  chk('nothing is used before it is declared',
      tdz.length === 0 && !tdzShown,
      tdz.join(' | ') || (tdzShown ? 'the page says so: ' +
        (shown.match(/[^\n]*before initialization[^\n]*/i) || [''])[0].trim() : ''));

  const undef = errors.filter(e => /is not defined|is not a function/i.test(e));
  chk('no missing functions or names', undef.length === 0, undef.join(' | '));

  /* The script must have run all the way to the bottom — that is where the
     test hooks are attached, so their presence proves it got there. */
  const reachedEnd = await p.evaluate(() => !!(window.__chalkline && window.__chalkline.tex));
  chk('the script ran to the end', reachedEnd);

  /* With accounts on, the class-code screen must never be what a student
     sees. Sign-in cannot complete here — the keys are fake and the network
     is blocked — but the old landing screen must still be put away. */
  const landingShown = await p.evaluate(() => {
    const el = document.getElementById('viewLanding');
    return !!el && !el.hidden;
  });
  chk('the class-code screen is not shown when accounts are on', !landingShown);

  const splashExists = await p.evaluate(() => !!document.getElementById('viewSplash'));
  chk('the class splash screen exists', splashExists);

  const waitPanel = await p.evaluate(() => !!document.getElementById('waitPanel'));
  chk('the approvals panel exists', waitPanel);

  /* A class id comes from the database, not from a person typing it, so it
     must survive untouched. The old code upper-cased it — a leftover from
     class codes — which meant every query asked for ALGEBRA2 while the table
     held algebra2. Nothing matched: no student ever reached the wall, nobody
     appeared in the approvals queue, and a board write broke its link to the
     class. It looked like an empty classroom rather than a bug. */
  chk('accounts really are on in this build',
      await p.evaluate(() => window.__chalkline.accounts() === true));
  const kept = await p.evaluate(() => window.__chalkline.room('algebra2'));
  chk('a class id keeps its case', kept === 'algebra2', 'got ' + JSON.stringify(kept));
  const kept2 = await p.evaluate(() => window.__chalkline.room('apcalcab'));
  chk('and so does the other one', kept2 === 'apcalcab', 'got ' + JSON.stringify(kept2));

  await browser.close();
  try { fs.unlinkSync(TEMP); } catch (e) {}

  console.log(`\nstart-up with accounts on: ${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
})().catch(e => {
  try { fs.unlinkSync(TEMP); } catch (_) {}
  console.error(e);
  process.exit(1);
});
