// Admin password handling, in one place for every request the dashboard makes.
//
// This used to live inside CrashList: it read localStorage, attached an Authorization header to
// its own GET, and on a 401 prompted and retried. That worked while there was exactly one
// authenticated request in the app. There are now four -- crashes and reports, each with a list
// and a delete -- and four copies of "remember the password, attach it, re-prompt on 401" is four
// chances for one of them to be forgotten. CrashCard's delete had already been forgotten, which
// was invisible only because DELETE had no authentication server-side to fail against.
//
// So it is an axios interceptor instead. Every request gets the header; every 401 gets one
// re-prompt and one retry, wherever it came from.

const KEY = 'password';

export function getPassword() {
    return localStorage.getItem(KEY) || '';
}

export function setPassword(value) {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
}

export function installAuth(axios) {
    axios.interceptors.request.use((config) => {
        const password = getPassword();
        if (password) {
            config.headers = config.headers || {};
            config.headers.Authorization = password;
        }
        return config;
    });

    axios.interceptors.response.use(
        (response) => response,
        (error) => {
            const config = error.config;
            const status = error.response && error.response.status;

            // RETRIED ONCE, AND ONLY ONCE. Without the flag a wrong password re-prompts on every
            // retry, which is a modal loop the user cannot escape without closing the tab -- and
            // with several requests in flight it is several loops at once.
            if (status === 401 && config && !config.__authRetried) {
                config.__authRetried = true;
                const entered = window.prompt('Enter admin password');
                if (entered) {
                    setPassword(entered);
                    return axios(config);
                }
                // Declining the prompt clears a stored password that is evidently wrong, so the
                // next attempt asks again rather than silently reusing it.
                setPassword('');
            }
            return Promise.reject(error);
        }
    );
}
