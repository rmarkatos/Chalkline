-- ===========================================================================
--  Chalkline — database and rules
--
--  Paste the whole file into Supabase → SQL Editor → Run. It is safe to run
--  more than once; it drops and rebuilds its own objects each time.
--
--  This replaces firebase-rules.json. It does the same job in a different
--  language: decide who may see and change what. Every rule here is a
--  "policy" attached to a table, and with row level security switched on a
--  table denies everything that no policy allows. It fails shut.
--
--  WHO IS WHO
--    Sign-in is Clerk's job, not Supabase's. Clerk hands Supabase a signed
--    token; these rules read two things out of it:
--        auth.jwt() ->> 'sub'      the person's Clerk user id
--        auth.jwt() ->> 'email'    their email address
--    A teacher is anyone whose email is listed in the teachers table. That
--    mirrors the old Firebase rule that tested auth.token.email, except a
--    second teacher is now a row to add rather than a rule to edit.
--
--  WHAT SURVIVES A LESSON
--    Only the roster: classes, teachers, enrolments. Every other table here
--    holds live lesson state and is emptied when the lesson ends. No student
--    work is ever kept, which is the same promise the app has always made.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  Helpers — small functions so the policies below read like English
-- ---------------------------------------------------------------------------

create or replace function public.clerk_uid() returns text
  language sql stable as $$ select auth.jwt() ->> 'sub' $$;

create or replace function public.clerk_email() returns text
  language sql stable as $$ select lower(auth.jwt() ->> 'email') $$;

create or replace function public.is_teacher() returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.teachers t where t.email = public.clerk_email())
  $$;

-- Is this person an approved student of this class? Used by nearly every
-- policy below, so it is written once here.
create or replace function public.is_approved_in(cls text) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from public.enrolments e
      where e.class_id = cls
        and e.student_id = public.clerk_uid()
        and e.status = 'approved'
    )
  $$;


-- ---------------------------------------------------------------------------
--  The roster — the only thing that outlives a lesson
-- ---------------------------------------------------------------------------

create table if not exists public.teachers (
  email      text primary key,
  added_at   timestamptz not null default now()
);

create table if not exists public.classes (
  id         text primary key,          -- 'algebra2', 'apcalcab'
  name       text not null,             -- what the student sees on the splash
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.enrolments (
  id           uuid primary key default gen_random_uuid(),
  class_id     text not null references public.classes(id) on delete cascade,
  student_id   text not null,           -- Clerk user id
  student_name text,
  student_email text,
  -- 'pending'  asked to join, waiting on the teacher
  -- 'approved' in the class
  -- 'removed'  was in the class and is not any more; kept so that a removed
  --            student cannot simply ask again and slip back in unnoticed
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'removed')),
  asked_at     timestamptz not null default now(),
  decided_at   timestamptz,
  unique (class_id, student_id)
);

create index if not exists enrolments_pending_idx
  on public.enrolments (class_id, status) where status = 'pending';


-- ---------------------------------------------------------------------------
--  Live lesson state — emptied when the lesson ends
--
--  A line of work is a string, always. A graph line is "%%G {...}", which is
--  a comment in LaTeX and therefore metadata by construction. The database
--  never needs to know the difference, and must not learn it.
-- ---------------------------------------------------------------------------

create table if not exists public.boards (
  class_id   text not null references public.classes(id) on delete cascade,
  student_id text not null,
  name       text,
  lines      jsonb not null default '[]'::jsonb,
  ids        jsonb not null default '[]'::jsonb,
  -- the heartbeat. A tile means a student is in the room now: the wall
  -- sweeps anything that has not beaten for 30 seconds, which is also what
  -- makes closing a tab tidy itself up without the database being told.
  at         timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table if not exists public.feedback (
  class_id   text not null references public.classes(id) on delete cascade,
  student_id text not null,
  lines      jsonb not null default '[]'::jsonb,
  notes      jsonb not null default '{}'::jsonb,   -- {lineId: latex}
  at         timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table if not exists public.checks (
  class_id   text not null references public.classes(id) on delete cascade,
  student_id text not null,
  checked    boolean not null default false,
  primary key (class_id, student_id)
);

create table if not exists public.problems (
  class_id   text primary key references public.classes(id) on delete cascade,
  items      jsonb not null default '[]'::jsonb,   -- [{lines[], images[]}]
  at         timestamptz not null default now()
);

create table if not exists public.timers (
  class_id   text primary key references public.classes(id) on delete cascade,
  -- server time, so a student joining late agrees with everyone else
  ends_at    timestamptz
);

create table if not exists public.sessions (
  class_id   text primary key references public.classes(id) on delete cascade,
  closed_at  timestamptz,
  ended      boolean not null default false   -- true = session over, not just closed
);


-- ---------------------------------------------------------------------------
--  Lock everything, then open exactly what is needed
-- ---------------------------------------------------------------------------

alter table public.teachers   enable row level security;
alter table public.classes    enable row level security;
alter table public.enrolments enable row level security;
alter table public.boards     enable row level security;
alter table public.feedback   enable row level security;
alter table public.checks     enable row level security;
alter table public.problems   enable row level security;
alter table public.timers     enable row level security;
alter table public.sessions   enable row level security;

-- Start from a clean slate so this file can be run again after an edit.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('teachers','classes','enrolments','boards',
                        'feedback','checks','problems','timers','sessions')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;


--  teachers ------------------------------------------------------------------
--  Nobody reads this table directly; is_teacher() looks inside it on their
--  behalf. Leaving it with no policy means the list of teachers is private.

--  classes -------------------------------------------------------------------
--  Any signed-in person may read the list of classes — that is the splash
--  screen. Only a teacher may change it.
create policy "anyone signed in can see the class list"
  on public.classes for select
  to authenticated using (true);

create policy "teachers manage classes"
  on public.classes for all
  to authenticated using (public.is_teacher()) with check (public.is_teacher());


--  enrolments ----------------------------------------------------------------
create policy "a student sees only their own enrolment"
  on public.enrolments for select
  to authenticated using (student_id = public.clerk_uid());

--  Asking to join. A student may create their own request and nobody else's,
--  and may only ever ask as 'pending' — they cannot approve themselves.
create policy "a student may ask to join"
  on public.enrolments for insert
  to authenticated
  with check (student_id = public.clerk_uid() and status = 'pending');

create policy "teachers see every enrolment"
  on public.enrolments for select
  to authenticated using (public.is_teacher());

create policy "teachers decide enrolments"
  on public.enrolments for all
  to authenticated using (public.is_teacher()) with check (public.is_teacher());


--  boards --------------------------------------------------------------------
--  A student writes their own board and reads it back. They can never see
--  another student's board — that is the wall, and the wall is the teacher's.
create policy "a student owns their board"
  on public.boards for all
  to authenticated
  using      (student_id = public.clerk_uid() and public.is_approved_in(class_id))
  with check (student_id = public.clerk_uid() and public.is_approved_in(class_id));

create policy "teachers see the whole wall"
  on public.boards for all
  to authenticated using (public.is_teacher()) with check (public.is_teacher());


--  feedback ------------------------------------------------------------------
--  A student reads their own feedback and cannot write any.
create policy "a student reads their own feedback"
  on public.feedback for select
  to authenticated
  using (student_id = public.clerk_uid() and public.is_approved_in(class_id));

create policy "teachers write feedback"
  on public.feedback for all
  to authenticated using (public.is_teacher()) with check (public.is_teacher());


--  checks --------------------------------------------------------------------
create policy "a student reads their own checkmark"
  on public.checks for select
  to authenticated
  using (student_id = public.clerk_uid() and public.is_approved_in(class_id));

create policy "teachers set checkmarks"
  on public.checks for all
  to authenticated using (public.is_teacher()) with check (public.is_teacher());


--  problems, timer, session --------------------------------------------------
--  Everyone approved in the class reads these; only the teacher sets them.
create policy "approved students read the problem"
  on public.problems for select
  to authenticated using (public.is_approved_in(class_id));

create policy "teachers push problems"
  on public.problems for all
  to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "approved students read the timer"
  on public.timers for select
  to authenticated using (public.is_approved_in(class_id));

create policy "teachers set the timer"
  on public.timers for all
  to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "approved students read the session state"
  on public.sessions for select
  to authenticated using (public.is_approved_in(class_id));

create policy "teachers open and close the session"
  on public.sessions for all
  to authenticated using (public.is_teacher()) with check (public.is_teacher());


-- ---------------------------------------------------------------------------
--  Reachability
--
--  "Automatically expose new tables" is switched off on this project, which
--  is the safer setting — a new table is unreachable until it is deliberately
--  opened. So each table has to be granted here. Row level security still
--  decides every row; this only decides which tables exist as far as the
--  browser is concerned.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select                         on public.classes    to authenticated;
grant select, insert, update, delete on public.enrolments to authenticated;
grant select, insert, update, delete on public.boards     to authenticated;
grant select, insert, update, delete on public.feedback   to authenticated;
grant select, insert, update, delete on public.checks     to authenticated;
grant select, insert, update, delete on public.problems   to authenticated;
grant select, insert, update, delete on public.timers     to authenticated;
grant select, insert, update, delete on public.sessions   to authenticated;

-- teachers is deliberately not granted: nobody reads it from the browser.

grant execute on function public.clerk_uid()        to authenticated;
grant execute on function public.clerk_email()      to authenticated;
grant execute on function public.is_teacher()       to authenticated;
grant execute on function public.is_approved_in(text) to authenticated;


-- ---------------------------------------------------------------------------
--  Live updates
--
--  Realtime only sends changes for tables in this publication, and it still
--  applies the policies above per subscriber — a student is never sent
--  another student's board.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['boards','feedback','checks','problems',
                           'timers','sessions','enrolments']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
--  Seed
-- ---------------------------------------------------------------------------

--  >>> CHANGE THIS LINE to your own email address before running. <<<
--  It must match the address you sign in to Chalkline with, exactly.
--  It is a placeholder here so that publishing this file does not publish
--  a personal email address for scrapers to collect.
--
--  For a second teacher, add another row:
--      insert into public.teachers (email) values ('them@example.com')
--        on conflict (email) do nothing;

insert into public.teachers (email) values ('you@example.com')
  on conflict (email) do nothing;

insert into public.classes (id, name, sort) values
  ('algebra2', 'Algebra 2',        1),
  ('apcalcab', 'AP Calculus AB',   2)
  on conflict (id) do update set name = excluded.name, sort = excluded.sort;


-- ---------------------------------------------------------------------------
--  Ending a lesson — erases the work, keeps the roster
-- ---------------------------------------------------------------------------

create or replace function public.end_lesson(cls text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher() then
    raise exception 'only a teacher may end a lesson';
  end if;
  delete from public.boards   where class_id = cls;
  delete from public.feedback where class_id = cls;
  delete from public.checks   where class_id = cls;
  delete from public.problems where class_id = cls;
  delete from public.timers   where class_id = cls;
  delete from public.sessions where class_id = cls;
end $$;

grant execute on function public.end_lesson(text) to authenticated;

-- Sweep boards that stopped beating. The wall calls this; it is how a closed
-- tab tidies itself up without the database being told anything.
create or replace function public.sweep_stale(cls text, older_than_seconds int default 30)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher() then
    raise exception 'only a teacher may sweep';
  end if;
  delete from public.boards
   where class_id = cls
     and at < now() - make_interval(secs => older_than_seconds);
end $$;

grant execute on function public.sweep_stale(text, int) to authenticated;
