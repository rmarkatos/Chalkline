/* Run supabase-schema.sql against a real Postgres and check the rules do what
   they say.

   Supabase is Postgres with a few things bolted on, so the schema cannot be
   run anywhere without them. This stands them in:

     auth.jwt()             Supabase reads the signed-in person out of a
                            request header. Here it reads a setting we set
                            ourselves, so a test can "be" anyone.
     authenticated          the role every signed-in browser acts as
     supabase_realtime      the publication that decides which tables send
                            live updates

   Then it signs in as a teacher, as an approved student, as a student still
   waiting, and as a stranger, and asserts what each can and cannot reach.

   This is the same idea as test-rules.js: the rules are only worth anything
   if something actually tries to break them.                              */

const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = process.argv[2] || path.join(__dirname, 'supabase-schema.sql');

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  if (ok) { pass++; }
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};

/* Become somebody. Everything after this call is judged by the policies as
   though this person made the request. */
async function as(db, claims) {
  await db.exec(`set local role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, true)`,
                 [JSON.stringify(claims || {})]);
}
async function asOwner(db) { await db.exec('reset role'); }

/* Did that go through, or did the rules stop it?

   Half of these attempts are meant to be refused, and in Postgres a refused
   statement poisons the whole transaction — every later one fails too, which
   would look like a wall of broken rules. Each attempt gets its own savepoint
   so a refusal stays where it happened. */
async function tryQuery(db, sql, params) {
  await db.exec('savepoint attempt');
  try {
    const rows = (await db.query(sql, params || [])).rows;
    await db.exec('release savepoint attempt');
    return { ok: true, rows };
  } catch (e) {
    await db.exec('rollback to savepoint attempt');
    return { ok: false, err: String(e.message || e) };
  }
}

(async () => {
  const db = new PGlite();

  // ---- the Supabase bits the schema expects to already exist --------------
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.jwt() returns jsonb
      language sql stable as $fn$
        select coalesce(
          nullif(current_setting('request.jwt.claims', true), '')::jsonb,
          '{}'::jsonb)
      $fn$;
    do $do$ begin
      if not exists (select 1 from pg_roles where rolname = 'authenticated')
        then create role authenticated; end if;
    end $do$;
    -- Supabase grants these itself. Without them the stand-in is harsher than
    -- the real thing and every policy that reads the token looks broken, so
    -- the tests below would be testing the stand-in rather than the rules.
    grant usage on schema auth to authenticated;
    grant execute on function auth.jwt() to authenticated;
    create publication supabase_realtime;
  `);

  // ---- the file itself ----------------------------------------------------
  const sql = fs.readFileSync(SQL, 'utf8');
  try {
    await db.exec(sql);
    chk('schema runs clean', true);
  } catch (e) {
    chk('schema runs clean', false, String(e.message || e));
    console.log('\nthe schema did not load, so nothing below could be checked');
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  // running it twice must be safe — the file says so at the top
  try { await db.exec(sql); chk('safe to run twice', true); }
  catch (e) { chk('safe to run twice', false, String(e.message || e)); }

  // ---- who's who ----------------------------------------------------------
  const TEACHER = { sub: 'user_teacher', email: 'you@example.com' };
  const APPROVED = { sub: 'user_amy', email: 'amy@school.org' };
  const PENDING = { sub: 'user_ben', email: 'ben@school.org' };
  const STRANGER = { sub: 'user_mallory', email: 'mallory@elsewhere.com' };

  await asOwner(db);
  await db.exec(`
    insert into public.enrolments (class_id, student_id, student_email, status)
      values ('algebra2', 'user_amy', 'amy@school.org', 'approved'),
             ('algebra2', 'user_ben', 'ben@school.org', 'pending')
      on conflict do nothing;
    insert into public.boards (class_id, student_id, name, lines)
      values ('algebra2', 'user_amy', 'Amy', '["x^2"]'::jsonb),
             ('algebra2', 'user_zoe', 'Zoe', '["y=3"]'::jsonb)
      on conflict do nothing;
    insert into public.feedback (class_id, student_id, lines)
      values ('algebra2', 'user_amy', '["good"]'::jsonb),
             ('algebra2', 'user_zoe', '["redo"]'::jsonb)
      on conflict do nothing;
    insert into public.problems (class_id, items) values ('algebra2', '[{"lines":["solve"]}]'::jsonb)
      on conflict do nothing;
  `);

  // ---- the teacher --------------------------------------------------------
  await db.exec('begin'); await as(db, TEACHER);
  chk('teacher is recognised',
      (await db.query('select public.is_teacher() as t')).rows[0].t === true);
  let r = await tryQuery(db, 'select * from public.boards');
  chk('teacher sees the whole wall', r.ok && r.rows.length === 2,
      r.ok ? 'saw ' + r.rows.length : r.err);
  r = await tryQuery(db, 'select * from public.enrolments');
  chk('teacher sees every enrolment', r.ok && r.rows.length === 2,
      r.ok ? 'saw ' + r.rows.length : r.err);
  r = await tryQuery(db,
    `update public.enrolments set status='approved' where student_id='user_ben' returning *`);
  chk('teacher can approve a student', r.ok && r.rows.length === 1, r.err);
  await db.exec('rollback');

  // ---- an approved student ------------------------------------------------
  await db.exec('begin'); await as(db, APPROVED);
  chk('student is not a teacher',
      (await db.query('select public.is_teacher() as t')).rows[0].t === false);
  r = await tryQuery(db, 'select * from public.boards');
  chk('student sees only their own board', r.ok && r.rows.length === 1 &&
      r.rows[0].student_id === 'user_amy',
      r.ok ? 'saw ' + r.rows.length : r.err);
  r = await tryQuery(db, 'select * from public.feedback');
  chk('student sees only their own feedback', r.ok && r.rows.length === 1 &&
      r.rows[0].student_id === 'user_amy',
      r.ok ? 'saw ' + r.rows.length : r.err);
  r = await tryQuery(db, 'select * from public.problems');
  chk('student can read the problem', r.ok && r.rows.length === 1, r.err);
  r = await tryQuery(db,
    `update public.boards set lines='["hacked"]'::jsonb where student_id='user_zoe' returning *`);
  chk('student CANNOT write another board', r.ok && r.rows.length === 0,
      r.ok ? 'changed ' + r.rows.length + ' rows' : r.err);
  r = await tryQuery(db,
    `update public.enrolments set status='approved' where student_id='user_ben' returning *`);
  chk('student CANNOT approve anyone', !r.ok || r.rows.length === 0,
      r.ok ? 'changed ' + r.rows.length + ' rows' : '');
  r = await tryQuery(db, `select * from public.enrolments`);
  chk('student sees only their own enrolment', r.ok && r.rows.length === 1 &&
      r.rows[0].student_id === 'user_amy', r.ok ? 'saw ' + r.rows.length : r.err);
  await db.exec('rollback');

  // ---- a student still waiting to be let in -------------------------------
  await db.exec('begin'); await as(db, PENDING);
  r = await tryQuery(db, 'select * from public.boards');
  chk('waiting student sees no boards', r.ok && r.rows.length === 0,
      r.ok ? 'saw ' + r.rows.length : r.err);
  r = await tryQuery(db, 'select * from public.problems');
  chk('waiting student cannot read the problem', r.ok && r.rows.length === 0,
      r.ok ? 'saw ' + r.rows.length : r.err);
  r = await tryQuery(db,
    `insert into public.boards (class_id, student_id, lines)
     values ('algebra2','user_ben','["x"]'::jsonb) returning *`);
  chk('waiting student cannot write a board', !r.ok, 'the insert went through');
  await db.exec('rollback');

  // ---- a stranger who has signed up but joined nothing --------------------
  await db.exec('begin'); await as(db, STRANGER);
  r = await tryQuery(db, 'select * from public.classes');
  chk('stranger can see the class list (the splash screen)',
      r.ok && r.rows.length === 2, r.ok ? 'saw ' + r.rows.length : r.err);
  r = await tryQuery(db, 'select * from public.boards');
  chk('stranger sees no boards', r.ok && r.rows.length === 0,
      r.ok ? 'saw ' + r.rows.length : r.err);
  r = await tryQuery(db, 'select * from public.feedback');
  chk('stranger sees no feedback', r.ok && r.rows.length === 0,
      r.ok ? 'saw ' + r.rows.length : r.err);
  r = await tryQuery(db, `select * from public.teachers`);
  chk('nobody can read the teacher list', !r.ok || r.rows.length === 0,
      r.ok ? 'saw ' + r.rows.length : '');
  // asking to join is the one thing they may do
  r = await tryQuery(db,
    `insert into public.enrolments (class_id, student_id, student_email, status)
     values ('apcalcab','user_mallory','mallory@elsewhere.com','pending') returning *`);
  chk('anyone signed in may ask to join', r.ok && r.rows.length === 1, r.err);
  // but never as approved
  r = await tryQuery(db,
    `insert into public.enrolments (class_id, student_id, student_email, status)
     values ('algebra2','user_mallory','mallory@elsewhere.com','approved') returning *`);
  chk('CANNOT let themselves straight in', !r.ok, 'the insert went through');
  // and never on somebody else's behalf
  r = await tryQuery(db,
    `insert into public.enrolments (class_id, student_id, status)
     values ('algebra2','user_someone_else','pending') returning *`);
  chk('CANNOT ask on behalf of someone else', !r.ok, 'the insert went through');
  await db.exec('rollback');

  // ---- ending a lesson ----------------------------------------------------
  await db.exec('begin'); await as(db, APPROVED);
  r = await tryQuery(db, `select public.end_lesson('algebra2')`);
  chk('a student CANNOT end the lesson', !r.ok, 'it ran');
  await db.exec('rollback');

  await db.exec('begin'); await as(db, TEACHER);
  r = await tryQuery(db, `select public.end_lesson('algebra2')`);
  chk('a teacher can end the lesson', r.ok, r.err);
  await asOwner(db);
  const left = await db.query(`select
      (select count(*) from public.boards    where class_id='algebra2') as boards,
      (select count(*) from public.problems  where class_id='algebra2') as problems,
      (select count(*) from public.enrolments where class_id='algebra2') as enrolments`);
  const L = left.rows[0];
  chk('ending erases the work', Number(L.boards) === 0 && Number(L.problems) === 0,
      `boards=${L.boards} problems=${L.problems}`);
  chk('ending keeps the roster', Number(L.enrolments) === 2, `enrolments=${L.enrolments}`);
  await db.exec('rollback');

  console.log(`\nschema + rules: ${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
