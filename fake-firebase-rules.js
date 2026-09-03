// An in-memory stand-in for the Firebase Realtime Database, replicated between
// pages over BroadcastChannel. Served in place of the real SDK so the adapter
// in chalkline-board.html is exercised exactly as written.
const store = (globalThis.__fakeStore ||= {});
const listeners = [];
const chan = new BroadcastChannel("fakefb");
let uidSeq = 0;

const get = p => p.split("/").filter(Boolean).reduce((o,k) => (o == null ? o : o[k]), store);
function put(p, v){
  const ks = p.split("/").filter(Boolean);
  let o = store;
  for(let i = 0; i < ks.length - 1; i++) o = (o[ks[i]] = o[ks[i]] || {});
  if(v === null) delete o[ks[ks.length-1]]; else o[ks[ks.length-1]] = v;
}
const snap = v => ({ val: () => (v === undefined ? null : v), key: null });

function notify(){
  for(const L of listeners){
    const v = get(L.path);
    if(L.kind === "value"){
      const j = JSON.stringify(v === undefined ? null : v);
      if(j !== L.last){ L.last = j; L.cb(snap(v === undefined ? null : v)); }
    } else {
      const now = (v && typeof v === "object") ? v : {};
      const was = L.seen || {};
      for(const k in now){
        const j = JSON.stringify(now[k]);
        if(!(k in was)){ if(L.kind === "added") L.cb({ val:()=>now[k], key:k }); }
        else if(was[k] !== j){ if(L.kind === "changed") L.cb({ val:()=>now[k], key:k }); }
      }
      for(const k in was) if(!(k in now) && L.kind === "removed") L.cb({ val:()=>null, key:k });
      L.seen = Object.fromEntries(Object.keys(now).map(k => [k, JSON.stringify(now[k])]));
    }
  }
}
function localWrite(p, v){ put(p, v); notify(); chan.postMessage({p, v}); }
/* a way for a test to plant state as if the server held it already */
globalThis.__fakeWrite = (path, v) => localWrite(path, v);

// A real database hands a late joiner everything already in it. The stand-in
// asks whoever is already open for a snapshot, so the same thing happens here.
chan.onmessage = e => {
  const m = e.data;
  if(m.req){ chan.postMessage({ full: store }); return; }
  if(m.full){
    // fill in anything this page has not seen; a local write always wins
    if(mergeMissing(store, m.full)) notify();
    return;
  }
  put(m.p, m.v); notify();
};
function mergeMissing(dst, src){
  let changed = false;
  for(const k in src){
    if(!(k in dst)){ dst[k] = src[k]; changed = true; }
    else if(src[k] && typeof src[k] === "object" && dst[k] && typeof dst[k] === "object"){
      if(mergeMissing(dst[k], src[k])) changed = true;
    }
  }
  return changed;
}
chan.postMessage({ req: true });

export function initializeApp(){ return {}; }

/* ---- auth ---------------------------------------------------------------
   Enough of it to exercise the real thing: one teacher account, anonymous
   sign-in for everyone else, and listeners that fire on every change.
   Session persistence across reloads is the real SDK's job, not modelled. */
const ACCOUNTS = { "mr@chalkline.test": "correct-horse" };
/* The page imports firebase-app, -database and -auth as three separate URLs,
   so this file is instantiated three times. The real SDK shares one auth
   session between them; hang it off the global so this does too. */
const authState = (globalThis.__fakeAuthState ||= { currentUser: null });
const authWatchers = (globalThis.__fakeAuthWatchers ||= []);
function setUser(u){
  authState.currentUser = u;
  authWatchers.slice().forEach(fn => fn(u));
}
export function getAuth(){ return authState; }
export function onAuthStateChanged(_a, cb){
  authWatchers.push(cb);
  Promise.resolve().then(() => cb(authState.currentUser));
  return () => {
    const i = authWatchers.indexOf(cb);
    if(i >= 0) authWatchers.splice(i, 1);
  };
}
export function signInAnonymously(){
  // Real anonymous sign-in gives ONE identity per browser, shared by every
  // tab. Modelling that matters: without it a test cannot see two tabs
  // colliding, which is exactly the fault this stand-in exists to catch.
  let id = get("__anon");
  if(!id){
    id = "u" + (++uidSeq) + "-" + Math.random().toString(36).slice(2, 7);
    localWrite("__anon", id);
  }
  const u = { uid: id, email: null, isAnonymous: true };
  setUser(u);
  return Promise.resolve({ user: u });
}
export function signInWithEmailAndPassword(_a, email, password){
  const key = String(email || "").toLowerCase();
  if(!/.+@.+/.test(key)){
    const e = new Error("invalid email"); e.code = "auth/invalid-email";
    return Promise.reject(e);
  }
  if(ACCOUNTS[key] !== password){
    const e = new Error("bad credentials"); e.code = "auth/invalid-credential";
    return Promise.reject(e);
  }
  const u = { uid: "t-" + key, email: key, isAnonymous: false };
  setUser(u);
  return Promise.resolve({ user: u });
}
export function signOut(){ setUser(null); return Promise.resolve(); }
export function getDatabase(){ return {}; }
export function ref(_db, path){ return { path }; }
/* ---- a stand-in for the published database rules -------------------------
   Only used by the diagnostic harness: the teacher (an account with an email)
   may do anything in a room; a student may write only their own board and read
   only the problem, the timer, and their own feedback and checkmark. */
function guard(path, write){
  const u = authState.currentUser;
  const deny = () => { const e = new Error("Permission denied"); e.code = "PERMISSION_DENIED"; throw e; };
  const m = /^rooms\/([^/]+)\/(.*)$/.exec(path);
  if(!m){
    if(/^rooms\/[^/]+$/.test(path) && !(u && u.email)) deny();
    return;
  }
  if(u && u.email) return;
  const rest = m[2];
  const own = /^boards\/(.+)$/.exec(rest);
  if(write && own && u && own[1].indexOf(u.uid) === 0) return;
  if(!write && /^(problem|timer|closed)$/.test(rest)) return;
  if(!write && u && /^(feedback|checks)\/(.+)$/.test(rest) &&
     rest.split("/")[1].indexOf(u.uid) === 0) return;
  deny();
}
export function set(r, v){ guard(r.path, true); localWrite(r.path, JSON.parse(JSON.stringify(v))); return Promise.resolve(); }
export function remove(r){ guard(r.path, true); localWrite(r.path, null); return Promise.resolve(); }
export function serverTimestamp(){ return Date.now(); }
/* Registrations are recorded so a test can check what would be cleaned up,
   and fired on demand to stand in for a tab closing. */
const onDisc = (globalThis.__fakeOnDisconnect ||= []);
export function onDisconnect(r){
  return {
    remove(){
      if(!onDisc.includes(r.path)) onDisc.push(r.path);
      return Promise.resolve();
    }
  };
}
globalThis.__fireDisconnect = path => {
  if(onDisc.includes(path)){ localWrite(path, null); return true; }
  return false;
};
function add(path, kind, cb, errCb){
  if(!/^\.info\//.test(path)){ try{ guard(path, false); }catch(err){ if(errCb) errCb(err); return () => {}; } }
  if(path === ".info/serverTimeOffset"){ cb(snap(0)); return () => {}; }
  if(path === ".info/connected"){ cb(snap(true)); return () => {}; }
  const L = { path, kind, cb, last: undefined, seen: null };
  listeners.push(L);
  const stop = () => { const i = listeners.indexOf(L); if(i >= 0) listeners.splice(i, 1); };
  const v = get(path);
  if(kind === "value"){ L.last = JSON.stringify(v === undefined ? null : v); cb(snap(v === undefined ? null : v)); }
  else {
    const now = (v && typeof v === "object") ? v : {};
    L.seen = {};
    for(const k in now){ L.seen[k] = JSON.stringify(now[k]); if(kind === "added") cb({ val:()=>now[k], key:k }); }
  }
  return stop;
}
export function onValue(r, cb, e){ return add(r.path, "value", cb, e); }
export function onChildAdded(r, cb, e){ return add(r.path, "added", cb, e); }
export function onChildChanged(r, cb, e){ return add(r.path, "changed", cb, e); }
export function onChildRemoved(r, cb, e){ return add(r.path, "removed", cb, e); }
