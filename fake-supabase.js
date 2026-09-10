/* An in-memory stand-in for supabase-js v2, replicated between pages over
   BroadcastChannel. Served in place of the real library (the test answers
   the CDN request with this file), so SupabaseSync and the accounts code in
   the built page run exactly as written against a database that lives in
   the browser.

   What it is faithful about, on purpose:
   - the column list. window.__FAKE_SCHEMA is {table: [columns]}, read out of
     supabase-schema.sql by the test. A write naming a column the schema does
     not have is refused with PGRST204, exactly as PostgREST refuses it —
     which is how a feature that exists in the app but not in the database
     gets caught here rather than by a student.
   - the rules, roughly. A student sees and writes only rows carrying their
     own student_id; only a teacher (email in the teachers table) may write
     problems, timers, sessions, or decide an enrolment. Refusals are 42501.
     The real rules are tested against real Postgres in test-schema.js.
   - live updates: there are none. The real ones never arrived in practice,
     and the app is built not to need them — so a channel here is a thing
     you can subscribe to that never speaks. If the app ever came to depend
     on it, this suite would show it.                                        */
(function(){
  const SCHEMA = globalThis.__FAKE_SCHEMA || {};
  const KEYS = {teachers:["email"], classes:["id"], enrolments:["id"],
                boards:["class_id","student_id"], feedback:["class_id","student_id"],
                checks:["class_id","student_id"], problems:["class_id"],
                timers:["class_id"], sessions:["class_id"]};
  const now = () => new Date().toISOString();
  const DEFAULTS = {
    enrolments: () => ({id: "enr_" + Math.random().toString(36).slice(2), status:"pending", asked_at: now()}),
    boards:     () => ({lines:[], ids:[], at: now(), joined_at: now()}),
    feedback:   () => ({lines:[], notes:{}, at: now()}),
    checks:     () => ({checked:false, marks:{}}),
    problems:   () => ({items:[], at: now()}),
    sessions:   () => ({ended:false}),
    timers:     () => ({}),
    classes:    () => ({sort:0}),
    teachers:   () => ({})
  };
  const seed = () => ({
    teachers: [{email:"you@example.com", display_name:"Your teacher"}],
    classes:  [{id:"algebra2", name:"Algebra 2", sort:1}, {id:"apcalcab", name:"AP Calculus AB", sort:2}],
    enrolments:[], boards:[], feedback:[], checks:[], problems:[], timers:[], sessions:[]
  });
  const store = (globalThis.__fakeSupaStore ||= seed());
  const chan = new BroadcastChannel("fakesupa");
  const keyOf = (t, r) => (KEYS[t] || ["id"]).map(k => r[k]).join("|");
  const matches = (r, where) => where.every(w =>
    w.op === "eq" ? String(r[w.col]) === String(w.val) :
    w.op === "lt" ? r[w.col] != null && r[w.col] < w.val :
    w.op === "gt" ? r[w.col] != null && r[w.col] > w.val : true);

  function apply(op){
    const rows = store[op.table] || (store[op.table] = []);
    /* op.row is what was sent; op.fresh is the same with the column defaults
       filled in by the page that wrote it — ONCE, so every page holds the
       same generated id and the same timestamp. (Filling defaults on each
       page gave the teacher one enrolment id and the student another.) An
       upsert onto a row that exists sets only the columns sent, as
       Postgres does — a heartbeat must not reset `ended` to its default. */
    if(op.kind === "upsert"){
      const k = keyOf(op.table, op.row);
      const i = rows.findIndex(r => keyOf(op.table, r) === k);
      if(i >= 0) rows[i] = Object.assign({}, rows[i], op.row);
      else rows.push(Object.assign({}, op.fresh || op.row));
    } else if(op.kind === "insert"){
      rows.push(Object.assign({}, op.fresh || op.row));
    } else if(op.kind === "update"){
      rows.forEach(r => { if(matches(r, op.where)) Object.assign(r, op.patch); });
    } else if(op.kind === "delete"){
      store[op.table] = rows.filter(r => !matches(r, op.where));
    }
  }
  function write(op){ apply(op); chan.postMessage({op}); }
  // a late joiner asks whoever is already open for what the database holds
  chan.onmessage = e => {
    const m = e.data;
    if(m.req){ chan.postMessage({full: store}); return; }
    if(m.full){
      for(const t in m.full){
        const rows = store[t] || (store[t] = []);
        for(const r of m.full[t]) if(!rows.some(x => keyOf(t, x) === keyOf(t, r))) rows.push(r);
      }
      return;
    }
    if(m.op) apply(m.op);
  };
  chan.postMessage({req:true});

  /* who is asking — what the token Clerk signed would say */
  const me = () => (globalThis.Clerk && globalThis.Clerk.user) || null;
  const myEmail = () => { const u = me(); return u && u.primaryEmailAddress ? String(u.primaryEmailAddress.emailAddress || "").toLowerCase() : ""; };
  const myId = () => { const u = me(); return u ? u.id : null; };
  const isTeacher = () => store.teachers.some(t => t.email === myEmail());
  const err = (code, message) => ({data:null, error:{code, message, details:null, hint:null}, status:400, statusText:"Bad Request"});
  const ok = data => ({data, error:null, status:200, statusText:"OK"});

  // what a student may see: their own rows, and the shared ones
  const visible = (t, r) => isTeacher() || !("student_id" in r) || r.student_id === myId();
  const mayWrite = (t, r) => {
    if(isTeacher()) return true;
    if(["problems","timers","sessions","classes","teachers"].includes(t)) return false;
    if(t === "enrolments") return r.student_id === myId() && (r.status || "pending") === "pending";
    return r.student_id === myId();
  };
  const unknownColumn = (t, row) => {
    const cols = SCHEMA[t]; if(!cols) return null;
    return Object.keys(row).find(k => !cols.includes(k)) || null;
  };

  function from(table){
    const q = {action:"select", where:[], order:null, row:null, patch:null};
    const b = {
      select(){ return b; },
      eq(col, val){ q.where.push({op:"eq", col, val}); return b; },
      lt(col, val){ q.where.push({op:"lt", col, val}); return b; },
      gt(col, val){ q.where.push({op:"gt", col, val}); return b; },
      order(col, o){ q.order = {col, asc: !(o && o.ascending === false)}; return b; },
      insert(row){ q.action = "insert"; q.row = row; return b; },
      upsert(row, opts){ q.action = "upsert"; q.row = row; q.opts = opts; return b; },
      update(patch){ q.action = "update"; q.patch = patch; return b; },
      delete(){ q.action = "delete"; return b; },
      then(res, rej){ return Promise.resolve().then(exec).then(res, rej); }
    };
    function exec(){
      if(!me()) return err("PGRST301", "JWT missing");
      const rows = store[table] || [];
      if(q.action === "select"){
        const out = rows.filter(r => matches(r, q.where) && visible(table, r)).map(r => Object.assign({}, r));
        if(q.order) out.sort((a, c) => (a[q.order.col] < c[q.order.col] ? -1 : a[q.order.col] > c[q.order.col] ? 1 : 0) * (q.order.asc ? 1 : -1));
        return ok(out);
      }
      if(q.action === "insert" || q.action === "upsert"){
        const bad = unknownColumn(table, q.row);
        if(bad) return err("PGRST204", "Could not find the '" + bad + "' column of '" + table + "' in the schema cache");
        if(!mayWrite(table, q.row)) return err("42501", "new row violates row-level security policy for table \"" + table + "\"");
        if(q.action === "insert" && table === "enrolments" &&
           rows.some(r => r.class_id === q.row.class_id && r.student_id === q.row.student_id))
          return err("23505", "duplicate key value violates unique constraint \"enrolments_class_id_student_id_key\"");
        write({kind: q.action, table, row: q.row,
               fresh: Object.assign(DEFAULTS[table] ? DEFAULTS[table]() : {}, q.row)});
        return ok(null);
      }
      if(q.action === "update"){
        const bad = unknownColumn(table, q.patch);
        if(bad) return err("PGRST204", "Could not find the '" + bad + "' column of '" + table + "' in the schema cache");
        const hit = rows.filter(r => matches(r, q.where));
        if(hit.some(r => !mayWrite(table, r))) return ok(null);   // the rules hide the row: nothing changes, no error
        write({kind:"update", table, where:q.where, patch:q.patch});
        return ok(null);
      }
      if(q.action === "delete"){
        const hit = rows.filter(r => matches(r, q.where) && mayWrite(table, r));
        if(hit.length) write({kind:"delete", table, where: q.where.concat(isTeacher() ? [] : [{op:"eq", col:"student_id", val:myId()}])});
        return ok(null);
      }
      return err("PGRST100", "unknown action");
    }
    return b;
  }

  function rpc(name, args){
    return Promise.resolve().then(() => {
      if(!me()) return err("PGRST301", "JWT missing");
      if(name === "server_now") return ok(now());
      if(name === "is_teacher") return ok(isTeacher());
      if(name === "my_teacher_name"){ const t = store.teachers.find(x => x.email === myEmail()); return ok(t ? t.display_name || null : null); }
      if(name === "end_lesson"){
        if(!isTeacher()) return err("P0001", "only a teacher may end a lesson");
        for(const t of ["boards","feedback","checks","problems","timers","sessions"])
          write({kind:"delete", table:t, where:[{op:"eq", col:"class_id", val:args.cls}]});
        return ok(null);
      }
      if(name === "sweep_stale"){
        if(!isTeacher()) return err("P0001", "only a teacher may sweep");
        const cutoff = new Date(Date.now() - 1000 * ((args && args.older_than_seconds) || 30)).toISOString();
        write({kind:"delete", table:"boards", where:[{op:"eq", col:"class_id", val:args.cls}, {op:"lt", col:"at", val:cutoff}]});
        return ok(null);
      }
      return err("PGRST202", "Could not find the function public." + name);
    });
  }

  const channel = () => { const ch = {on(){ return ch; }, subscribe(){ return ch; }, unsubscribe(){}}; return ch; };
  globalThis.supabase = {
    createClient(){ return {from, rpc, channel, removeChannel(){}, realtime:{setAuth(){}}}; }
  };
  /* for the test: plant rows as if the server held them, and read the lot */
  globalThis.__fakeSupa = {store, write, isTeacher, schema: SCHEMA};
})();
