/* A stand-in for Clerk's browser script. The test answers the request for
   clerk.browser.js with this file, so loadClerkScript() in the app runs as
   written and finds window.Clerk already built, as Clerk v5 leaves it.

   Who is signed in comes from window.__FAKE_USER, set by the test before the
   page loads: {id, email, firstName}. Nothing here talks to a network.       */
(function(){
  const listeners = [];
  const mk = u => u ? {id: u.id, firstName: u.firstName || null, fullName: u.fullName || null,
                       primaryEmailAddress: {emailAddress: u.email || ""}} : null;
  const C = {
    user: mk(globalThis.__FAKE_USER || null),
    session: null,
    loaded: false,
    async load(){ this.loaded = true; this.session = this.user ? {getToken: async () => "fake.token." + this.user.id} : null; },
    async signOut(){ this.user = null; this.session = null; globalThis.__fakeSignedOut = true;
                     listeners.forEach(f => f({user:null, session:null})); },
    mountSignIn(el, props){ el.textContent = "[Clerk sign-in box]"; el.dataset.mounted = "signin"; el.dataset.other = (props && props.signUpUrl) || ""; },
    unmountSignIn(el){ el.textContent = ""; delete el.dataset.mounted; },
    mountSignUp(el, props){ el.textContent = "[Clerk sign-up box]"; el.dataset.mounted = "signup"; el.dataset.other = (props && props.signInUrl) || ""; },
    unmountSignUp(el){ el.textContent = ""; delete el.dataset.mounted; },
    addListener(fn){ listeners.push(fn); return () => {}; },
    /* the test signs somebody in through the mounted box */
    __signIn(u){ this.user = mk(u); this.session = {getToken: async () => "fake.token." + u.id};
                 listeners.forEach(f => f({user:this.user, session:this.session})); }
  };
  globalThis.Clerk = C;
})();
