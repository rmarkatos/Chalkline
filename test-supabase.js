/* The database path, end to end.

   Every other classroom suite drives the Firebase path, because that is what
   runs when the settings are empty. Nothing automated ever exercised
   SupabaseSync or the accounts code — and that is where real students found
   the last four bugs (invisible problems, live boards erased, marks that
   went in and never came out, a banner for a column the database did not
   have yet).

   This suite builds a copy of the page WITH the accounts settings filled in,
   and answers the two library downloads with stand-ins: fake-clerk.js (who
   is signed in) and fake-supabase.js (an in-browser database that refuses
   unknown columns with PGRST204 and applies the rules roughly). The app's
   own code — loadClerkScript, ensureAccounts, SupabaseSync, the splash, the
   approvals queue, the wall — runs exactly as written.

   Then it runs a lesson: the teacher picks a class, a student asks to join
   and is approved, writes, gets a problem, feedback and a mark, goes away
   and comes back, a second student on an older database still gets a board,
   a stale row is dropped while a live one is never, and the lesson ends.   */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const HERE = __dirname;
const REAL = path.join(HERE, 'chalkline-board.html');
const TEMP = path.join(HERE, '_supa.html');
const LAUNCH = process.env.CHROME ? { executablePath: process.env.CHROME } : {};

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  if (ok) pass++;
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};

/* the same not-Ryan settings test-boot uses: the key decodes to
   example.clerk.accounts.dev, which is where the app will ask for Clerk */
const FAKE_SUPABASE = `window.CHALKLINE_SUPABASE = {
  url:             "https://example.supabase.co",
  publishableKey:  "sb_publishable_not_a_real_key"
};`;
const FAKE_CLERK = `window.CHALKLINE_CLERK = {
  publishableKey:  "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk"
};`;
/* The live build still carries the old Firebase settings (build.py fills
   them in), and the wall's Sign out / Erase everything button is only shown
   when they are there. Fill them with nothing that resolves, so the page has
   the same shape as the live one. Nothing here ever loads Firebase. */
const BLANK_FIREBASE = `window.CHALKLINE_FIREBASE = {
  apiKey:      "",
  authDomain:  "",
  databaseURL: "",
  projectId:   "",
  appId:       ""
};`;
const FAKE_FIREBASE = `window.CHALKLINE_FIREBASE = {
  apiKey:      "not-a-real-key",
  authDomain:  "example.invalid",
  databaseURL: "https://example.invalid",
  projectId:   "example",
  appId:       "1:0:web:0"
};`;

/* The column list, read out of the schema the way PostgREST reads it out of
   Postgres. Keeping this derived rather than typed means a column added to
   the SQL is known here at once, and a column the app writes that the SQL
   does not declare is refused here — the bug that reached students twice. */
function columnsFromSchema(sql){
  const cols = {};
  const table = /create table if not exists public\.(\w+)\s*\(([\s\S]*?)\);/g;
  let m;
  while((m = table.exec(sql))){
    cols[m[1]] = [];
    m[2].split('\n').forEach(line => {
      const c = /^\s*([a-z_]+)\s+(text|jsonb|timestamptz|boolean|int|uuid)\b/.exec(line);
      if(c) cols[m[1]].push(c[1]);
    });
  }
  const added = /alter table public\.(\w+) add column if not exists (\w+)/g;
  while((m = added.exec(sql))) (cols[m[1]] = cols[m[1]] || []).push(m[2]);
  return cols;
}

(async () => {
  let page = fs.readFileSync(REAL, 'utf8');
  const blankSupa = `window.CHALKLINE_SUPABASE = {\n  url:             "",\n  publishableKey:  ""\n};`;
  const blankClerk = `window.CHALKLINE_CLERK = {\n  publishableKey:  ""\n};`;
  chk('the built page has the settings blocks this test fills in',
      page.includes(blankSupa) && page.includes(blankClerk) && page.includes(BLANK_FIREBASE),
      'build.py or app.html changed shape — update test-supabase.js to match');
  page = page.replace(blankSupa, FAKE_SUPABASE).replace(blankClerk, FAKE_CLERK).replace(BLANK_FIREBASE, FAKE_FIREBASE);
  fs.writeFileSync(TEMP, page);

  const schema = columnsFromSchema(fs.readFileSync(path.join(HERE, 'supabase-schema.sql'), 'utf8'));
  chk('the schema parser found every table the app writes',
      ['boards','feedback','checks','problems','timers','sessions','enrolments','classes'].every(t => schema[t] && schema[t].length > 1),
      JSON.stringify(schema));
  chk('…including the columns added later (joined_at, away_since, marks)',
      schema.boards.includes('joined_at') && schema.boards.includes('away_since') && schema.checks.includes('marks'),
      JSON.stringify(schema.boards));

  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport:{width:1280, height:900} });
  const clerkJs = fs.readFileSync(path.join(HERE, 'fake-clerk.js'), 'utf8');
  const supaJs  = fs.readFileSync(path.join(HERE, 'fake-supabase.js'), 'utf8');
  const serve = body => r => r.fulfill({status:200, contentType:'application/javascript',
                                        headers:{'access-control-allow-origin':'*'}, body});
  await ctx.route('**/@clerk/clerk-js@5/**', serve(clerkJs));
  await ctx.route('**/@supabase/supabase-js@2', serve(supaJs));
  await ctx.route('**://example.supabase.co/**', r => r.abort());   // nothing may reach a network

  const errs = [];
  const open = async (user, sch) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push((user ? user.id : 'nobody') + ': ' + String(e.message).split('\n')[0]));
    await p.addInitScript(({u, s}) => { window.__FAKE_USER = u; window.__FAKE_SCHEMA = s; }, {u:user, s:sch || schema});
    await p.goto('file://' + TEMP);
    return p;
  };
  // wait for a condition, with the polls (2.5s sync, 4s splash, 5s wall) in mind
  const until = async (p, fn, arg, ms) => { try{ await p.waitForFunction(fn, arg, {timeout: ms || 9000}); return true; }catch(e){ return false; } };
  const banner = p => p.evaluate(() => { const b = document.getElementById('errBar'); return b && !b.hidden ? b.textContent : ''; });
  const buttons = p => p.evaluate(() => Array.from(document.querySelectorAll('#classPick button')).map(b => b.textContent));

  // ---- the teacher signs in and picks a class ----------------------------------
  const teacher = await open({id:'user_ryan', email:'you@example.com', firstName:'Ryan'});
  chk('the teacher is recognised and asked which class they are teaching',
      await until(teacher, () => /Which class are you teaching/.test((document.querySelector('#splashPick .signwhy') || {}).textContent || '')));
  let btns = await buttons(teacher);
  chk('both classes are offered by name', btns.length === 2 && /Algebra 2/.test(btns[0]) && /AP Calculus AB/.test(btns[1]), JSON.stringify(btns));
  await teacher.click('#classPick button');
  chk('the wall opens on the class name',
      await until(teacher, () => !document.getElementById('viewTeacher').hidden && document.getElementById('tRoom').textContent === 'Algebra 2'));
  chk('no error on the teacher page', !(await banner(teacher)), await banner(teacher));
  chk('the wall writes its heartbeat and name into the session row',
      await until(teacher, () => { const s = window.__fakeSupa.store.sessions.find(r => r.class_id === 'algebra2');
                                   return !!(s && s.teacher_at && s.teacher_name === 'Your teacher'); }));

  // ---- a student asks to join and is approved ---------------------------------
  const amy = await open({id:'user_amy', email:'amy@test.example', firstName:'Amy'});
  chk('a new student is asked which class they are in',
      await until(amy, () => /Which class are you in/.test((document.querySelector('#splashPick .signwhy') || {}).textContent || '')));
  btns = await buttons(amy);
  chk('every class is "Ask to join"', btns.length === 2 && btns.every(t => /^Ask to join/.test(t)), JSON.stringify(btns));
  await amy.click('#classPick button');
  // with two classes on offer the list stays, and the asked-for one is greyed
  chk('asking greys that class out as "waiting for approval"',
      await until(amy, () => Array.from(document.querySelectorAll('#classPick button')).some(b => b.disabled && /Algebra 2 .* waiting for approval/.test(b.textContent))),
      JSON.stringify(await buttons(amy)));
  chk('the request is a pending enrolment row',
      await until(amy, () => window.__fakeSupa.store.enrolments.some(e => e.student_id === 'user_amy' && e.class_id === 'algebra2' && e.status === 'pending')));
  chk('the wall shows "1 waiting" within its poll',
      await until(teacher, () => { const b = document.getElementById('tWaiting'); return !b.hidden && b.textContent === '1 waiting'; }));
  const who = await teacher.evaluate(() => (document.querySelector('#waitRows .waitrow .hintline') || {}).textContent || '');
  chk('…with the student\'s name and email', /Amy/.test(who) && /amy@test\.example/.test(who), who);
  await teacher.click('#waitRows .waitrow button.on');                 // Approve
  chk('approval updates the enrolment row',
      await until(teacher, () => window.__fakeSupa.store.enrolments.some(e => e.student_id === 'user_amy' && e.status === 'approved')));
  chk('the waiting count clears', await until(teacher, () => document.getElementById('tWaiting').hidden));
  chk('the student is offered "Open Algebra 2" without refreshing',
      await until(amy, () => Array.from(document.querySelectorAll('#classPick button')).some(b => b.textContent === 'Open Algebra 2' && !b.disabled)));
  chk('the other class is still "Ask to join"',
      (await buttons(amy)).some(t => /^Ask to join AP Calculus AB/.test(t)), JSON.stringify(await buttons(amy)));
  await amy.click('text=Open Algebra 2');
  chk('the board opens', await until(amy, () => !document.getElementById('viewBoard').hidden));
  chk('the student sees the teacher is here',
      await until(amy, () => { const t = document.getElementById('teacherHere'); return !!t && !t.hidden && /logged in/.test(t.textContent); }, null, 12000));
  chk('no error on the student page', !(await banner(amy)), await banner(amy));

  // ---- typing reaches the wall ------------------------------------------------
  await amy.focus('#hidden'); await amy.keyboard.type('x^2+1', {delay:4});
  chk('the board row carries the work, the name, and an away_since column',
      await until(amy, () => { const b = window.__fakeSupa.store.boards.find(r => r.student_id === 'user_amy');
                               return !!b && b.name === 'Amy' && /x\^\{?2\}?\+1/.test(JSON.stringify(b.lines)) && ('away_since' in b) && b.away_since === null; }),
      JSON.stringify(await amy.evaluate(() => window.__fakeSupa.store.boards)));
  chk('a tile appears on the wall with the maths',
      await until(teacher, () => { const t = document.querySelector('#tiles .tile');
                                   return !!t && /Amy/.test(t.textContent) && /x/.test((t.querySelector('.tilebody') || {}).textContent || ''); }));

  // ---- a pushed problem, with a timer -----------------------------------------
  await teacher.click('#tPush'); await teacher.waitForTimeout(200);
  await teacher.focus('#hidden'); await teacher.keyboard.type('y=3x', {delay:4});
  await teacher.fill('#probMins', '1');
  await teacher.click('#probSend');
  chk('the problem row is written', await until(teacher, () => { const p = window.__fakeSupa.store.problems.find(r => r.class_id === 'algebra2'); return !!p && p.items.length === 1; }));
  chk('the timer row is written', await until(teacher, () => window.__fakeSupa.store.timers.some(r => r.class_id === 'algebra2' && r.ends_at)));
  chk('the student gets a Problem #1 workspace', await until(amy, () => window.__chalkline.linesRaw().some(l => /Problem #1/.test(l))));
  chk('the problem itself shows in the panel',
      await until(amy, () => /3/.test((document.querySelector('#viewBoard .wsproblem') || {}).textContent || '')));
  chk('the student\'s clock is running',
      await until(amy, () => { const c = document.getElementById('probClock'); return !!c && !c.hidden && /\d/.test(c.textContent); }));

  // ---- feedback and a mark ----------------------------------------------------
  await teacher.click('#tiles .tile');
  chk('the student\'s panel opens', await until(teacher, () => !document.getElementById('actingBar').hidden));
  await teacher.focus('#hidden'); await teacher.keyboard.type('nice', {delay:4});
  chk('feedback reaches the student',
      await until(amy, () => { const f = document.getElementById('fbPanel'); return !!f && !f.hidden && /nice/.test(document.getElementById('fbLines').textContent); }));
  const clicked = await teacher.evaluate(() => {
    const g = Array.from(document.querySelectorAll('#workLines .wsgroup')).find(x => /Problem #1/.test(x.querySelector('.wsghead').textContent));
    const b = g && g.querySelector('.partmark-btn'); if(b) b.click(); return !!b;
  });
  chk('the Problem #1 mark button is there', clicked);
  chk('the mark reaches the student', await until(amy, () => window.__chalkline.marks()['Problem #1'] === true));
  chk('the check row carries per-workspace marks',
      await until(amy, () => { const c = window.__fakeSupa.store.checks.find(r => r.student_id === 'user_amy'); return !!c && !!c.marks && c.marks['Problem #1'] === true; }));
  await teacher.click('#actingBack'); await teacher.waitForTimeout(300);

  // ---- away, and back ---------------------------------------------------------
  await amy.evaluate(() => window.__chalkline.setAway(true));
  chk('away_since is written to the board row',
      await until(amy, () => { const b = window.__fakeSupa.store.boards.find(r => r.student_id === 'user_amy'); return !!(b && b.away_since); }));
  chk('the tile goes red on the wall', await until(teacher, () => { const t = document.querySelector('#tiles .tile'); return !!t && t.classList.contains('away'); }));
  await amy.evaluate(() => window.__chalkline.setAway(false));
  chk('…and clears when they come back', await until(teacher, () => { const t = document.querySelector('#tiles .tile'); return !!t && !t.classList.contains('away'); }));

  // ---- a student on a database that has not had the latest paste ---------------
  const oldSchema = JSON.parse(JSON.stringify(schema));
  oldSchema.boards = oldSchema.boards.filter(c => c !== 'away_since');
  const ben = await open({id:'user_ben', email:'ben@test.example', firstName:'Ben'}, oldSchema);
  await until(ben, () => document.querySelectorAll('#classPick button').length === 2);
  await ben.click('#classPick button');
  chk('the wall shows Ben waiting', await until(teacher, () => /Ben/.test(document.getElementById('waitRows').textContent)));
  await teacher.click('#waitRows .waitrow button.on');
  chk('Ben is offered the class', await until(ben, () => Array.from(document.querySelectorAll('#classPick button')).some(b => b.textContent === 'Open Algebra 2')));
  await ben.click('text=Open Algebra 2');
  await until(ben, () => !document.getElementById('viewBoard').hidden);
  await ben.focus('#hidden'); await ben.keyboard.type('7', {delay:4});
  chk('a database without away_since still gets Ben\'s board (the PGRST204 fallback)',
      await until(ben, () => { const b = window.__fakeSupa.store.boards.find(r => r.student_id === 'user_ben'); return !!b && !('away_since' in b) && /7/.test(JSON.stringify(b.lines)); }),
      JSON.stringify(await ben.evaluate(() => window.__fakeSupa.store.boards.filter(r => r.student_id === 'user_ben'))));
  chk('…with no error banner on Ben\'s page', !(await banner(ben)), await banner(ben));
  chk('…and Ben has a tile on the wall', await until(teacher, () => Array.from(document.querySelectorAll('#tiles .tile')).some(t => /Ben/.test(t.textContent))));

  // ---- a stale row is dropped; a live one is never -----------------------------
  await teacher.evaluate(() => window.__fakeSupa.write({kind:'upsert', table:'boards',
    row:{class_id:'algebra2', student_id:'user_old', name:'Old', lines:['1'], ids:['a'],
         at:new Date(Date.now() - 90000).toISOString(), joined_at:new Date(Date.now() - 90000).toISOString(), away_since:null}}));
  chk('a board left over from an earlier lesson is deleted by the wall',
      await until(teacher, () => !window.__fakeSupa.store.boards.some(r => r.student_id === 'user_old')));
  chk('…and never shown', !(await teacher.evaluate(() => Array.from(document.querySelectorAll('#tiles .tile')).some(t => /Old/.test(t.textContent)))));
  // a wall that has stopped hearing must not erase live work: make it impatient and watch the database refuse
  await teacher.evaluate(() => window.__chalkboard.presence(1));
  await teacher.waitForTimeout(3500);
  chk('a live board survives a wall that thinks everyone has left',
      await teacher.evaluate(() => window.__fakeSupa.store.boards.some(r => r.student_id === 'user_amy')));
  await teacher.evaluate(() => window.__chalkboard.presence(30000));
  chk('and the tile comes back', await until(teacher, () => Array.from(document.querySelectorAll('#tiles .tile')).some(t => /Amy/.test(t.textContent))));

  // ---- nobody signed in: the mounted box, then a sign-in through it -------------
  const nobody = await open(null);
  chk('with nobody signed in, the sign-in box is mounted on the splash',
      await until(nobody, () => { const b = document.getElementById('clerkAuth'); return !!b && !b.hidden && b.dataset.mounted === '1'; }));
  await nobody.evaluate(() => window.Clerk.__signIn({id:'user_cara', email:'cara@test.example', firstName:'Cara'}));
  chk('signing in takes the box down and shows the classes',
      await until(nobody, () => document.getElementById('clerkAuth').hidden && document.querySelectorAll('#classPick button').length === 2));

  // ---- leaving, and ending the lesson -----------------------------------------
  await amy.click('#leaveBtn');
  chk('leaving shows the resting screen', await until(amy, () => !document.getElementById('splashLeft').hidden));
  chk('leaving removes the board row', await until(amy, () => !window.__fakeSupa.store.boards.some(r => r.student_id === 'user_amy')));
  chk('the tile leaves the wall', await until(teacher, () => !Array.from(document.querySelectorAll('#tiles .tile')).some(t => /Amy/.test(t.textContent))));
  await teacher.click('#tSignOut'); await teacher.waitForTimeout(300); await teacher.click('#tSignOut');
  chk('ending the lesson empties the class tables',
      await until(teacher, () => ['boards','feedback','checks','problems','timers','sessions'].every(t => !window.__fakeSupa.store[t].some(r => r.class_id === 'algebra2')), null, 12000),
      JSON.stringify(await teacher.evaluate(() => Object.fromEntries(['boards','feedback','checks','problems','timers','sessions'].map(t => [t, window.__fakeSupa.store[t].length])))));
  chk('but the roster survives', await teacher.evaluate(() => window.__fakeSupa.store.enrolments.filter(e => e.status === 'approved').length === 2));
  chk('Ben is sent out', await until(ben, () => !document.getElementById('splashLeft').hidden));
  chk('the teacher is signed out of Clerk', await until(teacher, () => window.__fakeSignedOut === true));

  chk('no page threw', errs.length === 0, errs.join(' | '));
  console.log(`\nsupabase path: ${pass} passed, ${fail} failed`);
  await browser.close();
  try{ fs.unlinkSync(TEMP); }catch(e){}
  if(fail) process.exit(1);
})();
