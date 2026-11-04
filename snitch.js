const path = require('path');
const { createServer } = require('./lib/server');

// CONFIGURED FROM THE ENVIRONMENT, not from a tracked file.
//
// This repository used to carry a config.js holding the admin password, which is why it was
// removed when the history was squashed for GitHub. Removing it took the AUTHENTICATION with it,
// though -- every crash route was left open. Environment variables give back the configurability
// without putting a secret in the repository. See the README for every variable.
//
// The defaults match what the server has always done, so an existing deployment behaves the same
// if nothing new is set -- except that crashes are now sanitised and rate limited like reports.
const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

const server = createServer({
    password: env.ADMIN_PASSWORD || '',
    dbPath: env.DB_PATH || './snitch.db',
    reportDbPath: env.REPORT_DB_PATH || './reports.db',
    groupDbPath: env.GROUP_DB_PATH || './groups.db',
    games: list(env.GAMES),
    defaultGame: env.DEFAULT_GAME || 'raifuwars',
    crashRateLimit: parseInt(env.CRASH_RATE_LIMIT || '60', 10),
    reportRateLimit: parseInt(env.REPORT_RATE_LIMIT || '20', 10),
    retentionDays: parseInt(env.RETENTION_DAYS || '730', 10),
    trustProxy: env.TRUST_PROXY || 'loopback',
    staticDir: path.join(__dirname, 'app', 'dist'),
    // Staff sign-in through Yotis Online, when YOTIS_URL is set. The account API must list this
    // service in its STAFF_SERVICES with exactly YOTIS_CALLBACK.
    yotis: env.YOTIS_URL ? {
        signin: env.YOTIS_URL.replace(/\/$/, '') + '/staff',
        service: env.YOTIS_SERVICE || 'crash',
        callback: env.YOTIS_CALLBACK || '',
        jwksUrl: env.YOTIS_JWKS_URL || env.YOTIS_URL.replace(/\/$/, '') + '/api/.well-known/staff-jwks',
    } : null,
});

if (!env.ADMIN_PASSWORD && !env.YOTIS_URL) console.warn('WARNING: neither YOTIS_URL nor ADMIN_PASSWORD is set -- every admin route is unauthenticated');
if (env.YOTIS_URL && !env.YOTIS_CALLBACK) console.warn('WARNING: YOTIS_URL is set without YOTIS_CALLBACK -- the dashboard cannot sign in through Yotis');
if (!list(env.GAMES).length) console.warn('WARNING: GAMES is not set -- crashes from any game id are accepted');

const port = parseInt(env.PORT || '3001', 10);
server.start(port, env.HOST).then(() => {
    console.log(`Snitch Server running on ${env.HOST || '*'}:${port}`);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
