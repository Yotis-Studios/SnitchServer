// Signing in, in one place for every request the dashboard makes: an axios interceptor attaches
// the credential to every request and handles every 401, wherever it came from.
//
// Normally that is a Yotis staff token. The server says where to sign in (/api/auth); a 401 sends
// the browser to the Yotis site's /staff page, which comes back to this page with the token in
// the #fragment, alongside the random state this page left in sessionStorage before it went. A
// token whose state does not match is ignored: it was not this tab that asked for it. Tokens
// live an hour; the next 401 after that goes round again, without a password prompt when this
// tab is still signed in to Yotis.
//
// The old shared password still works where the server allows it, as the way in when the account
// API is down: open the dashboard with ?password to be asked for it.

const TOKEN = 'snitch.token';
const STATE = 'snitch.state';
const BOUNCED = 'snitch.bounced';
const PASSWORD = 'password';

const store = {
    get: (s, k) => { try { return s.getItem(k) || ''; } catch (e) { return ''; } },
    set: (s, k, v) => { try { if (v) s.setItem(k, v); else s.removeItem(k); } catch (e) { /* memory only */ } },
};

// Back from Yotis: take the token if this tab asked for it, and clean the address bar.
function takeToken() {
    if (!location.hash.startsWith('#')) return;
    const q = new URLSearchParams(location.hash.slice(1));
    if (!q.has('token')) return;
    const expected = store.get(sessionStorage, STATE);
    if (expected && q.get('state') === expected) store.set(sessionStorage, TOKEN, q.get('token'));
    store.set(sessionStorage, STATE, '');
    history.replaceState(null, '', location.pathname + location.search);
}

function randomState() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function signedInWith() {
    return store.get(sessionStorage, TOKEN) ? 'yotis' : (store.get(localStorage, PASSWORD) ? 'password' : '');
}

export function signOut() {
    store.set(sessionStorage, TOKEN, '');
    store.set(localStorage, PASSWORD, '');
}

export function installAuth(axios) {
    takeToken();
    const wantsPassword = new URLSearchParams(location.search).has('password');
    let config = null;
    const authConfig = () => config || (config = axios.get('/api/auth', { __noAuth: true }).then((r) => r.data, () => ({ yotis: null, password: true })));

    axios.interceptors.request.use((req) => {
        if (req.__noAuth) return req;
        req.headers = req.headers || {};
        const token = store.get(sessionStorage, TOKEN);
        const password = store.get(localStorage, PASSWORD);
        if (token && !wantsPassword) req.headers.Authorization = 'Bearer ' + token;
        else if (password) req.headers.Authorization = password;
        return req;
    });

    axios.interceptors.response.use(
        (response) => {
            store.set(sessionStorage, BOUNCED, '');
            return response;
        },
        async (error) => {
            const req = error.config;
            const status = error.response && error.response.status;
            if (status !== 401 || !req || req.__noAuth || req.__authRetried) return Promise.reject(error);
            req.__authRetried = true;
            const auth = await authConfig();
            store.set(sessionStorage, TOKEN, '');

            if (auth.yotis && auth.yotis.callback && !wantsPassword) {
                // ONE round trip a minute. Back from Yotis with a token the server still refuses
                // (an account that lost its role, a clock far off) must stop here rather than
                // bounce between the two sites forever.
                const last = Number(store.get(sessionStorage, BOUNCED)) || 0;
                if (Date.now() - last < 60000) {
                    error.signInFailed = 'Signed in through Yotis, but this server refused the account. It needs a studio admin account.';
                    return Promise.reject(error);
                }
                store.set(sessionStorage, BOUNCED, String(Date.now()));
                const state = randomState();
                store.set(sessionStorage, STATE, state);
                const q = new URLSearchParams({ service: auth.yotis.service, redirect: auth.yotis.callback, state });
                location.assign(auth.yotis.signin + '?' + q);
                return new Promise(() => {});   // the page is leaving; nothing should render an error first
            }

            if (auth.password) {
                // Asked once per request, and only once: a wrong password re-prompting on every
                // retry is a modal loop the user cannot leave without closing the tab.
                const entered = window.prompt('Enter admin password');
                if (entered) {
                    store.set(localStorage, PASSWORD, entered);
                    return axios(req);
                }
                store.set(localStorage, PASSWORD, '');
            }
            return Promise.reject(error);
        }
    );
}
