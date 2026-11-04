const crypto = require('crypto');
const express = require('express');
const serveStatic = require('serve-static');
const Datastore = require('@seald-io/nedb');
const { createVerifier } = require('./yotis');

// Everything the server does, built from a config object rather than read from the environment
// directly, so the tests can start one on a random port with throwaway files. snitch.js reads
// the environment and calls this.

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// OS fields a crash may carry. A whitelist, not "whatever os_get_info returned": on some
// platforms that map holds device identifiers, and a crash dashboard has no use for them. The
// old Raifu Wars client sends the whole map as a JSON string; it is parsed and cut down to these
// on the way in, so nothing outside the list is ever written to disk.
const OS_KEYS = [
    'os_type', 'os_version', 'browser', 'video_adapter_description', 'video_driver_version',
    'video_d3d11_feature_level', 'is64bit', 'model', 'manufacturer', 'android_sdk', 'device_type',
    'gl_vendor_string', 'gl_renderer_string', 'gl_version_string', 'mobile', 'cpu_name',
];

function str(v, max) {
    if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
    return typeof v === 'string' ? v.slice(0, max) : '';
}

function pickOs(os) {
    if (typeof os === 'string') {
        try { os = JSON.parse(os); } catch (e) { return undefined; }
    }
    if (!os || typeof os !== 'object' || Array.isArray(os)) return undefined;
    const out = {};
    for (const k of OS_KEYS) {
        const v = os[k];
        if (typeof v === 'string') out[k] = v.slice(0, 200);
        else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
}

// The same error must land in the same group from every player, every run and every version,
// so the fingerprint leaves out what varies between them: the version (a group should span the
// release that fixed it), the line (any edit above it moves it), and long numbers in the message
// (instance ids, addresses). What is left is the game, where it happened and what went wrong.
function fingerprint(game, script, message) {
    const norm = String(message)
        .replace(/0x[0-9a-f]+/gi, '#')
        .replace(/-?\d{4,}/g, '#')
        .replace(/\s+/g, ' ')
        .trim();
    return crypto.createHash('sha1').update(`${game}\n${script}\n${norm}`).digest('hex').slice(0, 16);
}

// Per-key hourly cap. In memory on purpose: it exists to stop somebody leaning on an endpoint,
// not to survive a restart.
function rateLimiter(limit) {
    const hits = new Map();
    let sweptAt = Date.now();
    return function limited(key) {
        const now = Date.now();
        // Forget idle keys now and then, or every address that ever posted stays in memory.
        if (now - sweptAt > HOUR) {
            for (const [k, list] of hits) if (!list.length || now - list[list.length - 1] >= HOUR) hits.delete(k);
            sweptAt = now;
        }
        const list = (hits.get(key) || []).filter((t) => now - t < HOUR);
        if (list.length >= limit) {
            hits.set(key, list);
            return true;
        }
        list.push(now);
        hits.set(key, list);
        return false;
    };
}

function load(db) {
    return new Promise((resolve, reject) => db.loadDatabase((err) => (err ? reject(err) : resolve())));
}

function createServer(config) {
    const cfg = Object.assign({
        password: '',
        dbPath: './snitch.db',
        reportDbPath: './reports.db',
        groupDbPath: './groups.db',
        games: [],                 // accepted game ids; empty accepts any well-formed id
        defaultGame: 'raifuwars',  // what a crash or report without a game id belongs to
        crashRateLimit: 60,
        reportRateLimit: 20,
        retentionDays: 730,
        trustProxy: 'loopback',
        yotis: null,               // {signin, service, callback, jwksUrl | fetchJwks}: staff sign-in through Yotis Online
        staticDir: null,
        log: console,
    }, config);
    const log = cfg.log;

    const db = new Datastore({ filename: cfg.dbPath });
    const reportDb = new Datastore({ filename: cfg.reportDbPath });
    // One small document per crash group that somebody has acted on (resolved, so far). Kept out
    // of snitch.db so a group's state survives its crashes being pruned or deleted.
    const groupDb = new Datastore({ filename: cfg.groupDbPath });
    const crashLimited = rateLimiter(cfg.crashRateLimit);
    const reportLimited = rateLimiter(cfg.reportRateLimit);

    // Two ways in. A Yotis staff token (Authorization: Bearer <token>), which the account API only
    // gives accounts with the role it registered this service for -- the normal one. And the old
    // shared password, raw in the header, kept as the way in when the account API is down; leave
    // ADMIN_PASSWORD unset to turn it off. Neither configured leaves the admin routes open, which
    // keeps local development easy -- and is exactly why snitch.js warns about it on boot.
    // The password is compared in constant time, so it cannot be guessed a character at a time.
    const expected = Buffer.from(crypto.createHash('sha256').update(cfg.password).digest('hex'));
    const staffToken = cfg.yotis ? createVerifier(cfg.yotis) : null;
    async function requireAdmin(req, res, next) {
        if (!cfg.password && !staffToken) return next();
        const header = String(req.headers.authorization || '');
        if (staffToken && header.startsWith('Bearer ')) {
            try {
                req.staff = await staffToken(header.slice(7));
                return next();
            } catch (err) {
                return res.status(401).send('Sign in again');
            }
        }
        if (cfg.password) {
            const given = Buffer.from(crypto.createHash('sha256').update(header).digest('hex'));
            if (crypto.timingSafeEqual(given, expected)) return next();
        }
        res.status(401).send('Unauthorized');
    }

    // The game a payload belongs to. Missing means a client from before games were told apart,
    // which is only ever Raifu Wars. Present but unknown is refused: the list is what keeps one
    // typo, or one stranger, from inventing games on the dashboard.
    function gameOf(body) {
        const g = body.game;
        if (g === undefined || g === null || g === '') return cfg.defaultGame;
        if (typeof g !== 'string' || !GAME_ID.test(g)) return null;
        if (cfg.games.length && !cfg.games.includes(g)) return null;
        return g;
    }

    // A crash arrives from a game client, so nothing in it is trustworthy. Rebuilt field by field
    // rather than stored as sent, the same rule the report endpoint has always had: an unbounded
    // body on an unauthenticated endpoint is how a small nedb file becomes a large one, and
    // arbitrary client keys would let a caller shape what the dashboard later renders.
    function sanitiseCrash(body, game) {
        const stack = Array.isArray(body.stacktrace) ? body.stacktrace : (typeof body.stacktrace === 'string' ? [body.stacktrace] : []);
        const crash = {
            game,
            version: str(body.version, 32),
            up_version: str(body.up_version, 32),
            environment: str(body.environment, 32),
            platform: str(body.platform, 32),
            engine: str(body.engine, 32),
            session: str(body.session, 64),
            context: str(body.context, 200),
            uncaught: body.uncaught === true,
            message: str(body.message, 1000) || 'Unknown crash',
            longMessage: str(body.longMessage, 8000),
            script: str(body.script, 256),
            line: Number.isFinite(body.line) ? body.line : -1,
            stacktrace: stack.slice(0, 64).map((s) => str(s, 256)),
        };
        // How many times the client saw this one before sending it, when it batches repeats.
        if (Number.isInteger(body.repeats) && body.repeats > 1) crash.repeats = Math.min(body.repeats, 100000);
        const os = pickOs(body.os);
        if (os) crash.os = os;
        crash.fingerprint = fingerprint(game, crash.script, crash.message);
        return crash;
    }

    function sanitiseReport(body, game) {
        const lines = Array.isArray(body.lines) ? body.lines.slice(0, 20) : [];
        return {
            kind: 'player_report',
            game,
            version: str(body.version, 32),
            reporterUid: str(body.reporterUid, 64),
            reporterName: str(body.reporterName, 64),
            reportedSlot: Number.isFinite(body.reportedSlot) ? body.reportedSlot : -1,
            reportedName: str(body.reportedName, 64),
            server: str(body.server, 128),
            lines: lines.map((l) => str(l, 280)),
        };
    }

    const find = (store, query, sort, limit) => new Promise((resolve, reject) => {
        let cur = store.find(query);
        if (sort) cur = cur.sort(sort);
        if (limit) cur = cur.limit(limit);
        cur.exec((err, docs) => (err ? reject(err) : resolve(docs)));
    });
    const remove = (store, query, multi) => new Promise((resolve, reject) =>
        store.remove(query, { multi }, (err, n) => (err ? reject(err) : resolve(n))));
    const insert = (store, doc) => new Promise((resolve, reject) =>
        store.insert(doc, (err, d) => (err ? reject(err) : resolve(d))));
    const upsert = (store, query, doc) => new Promise((resolve, reject) =>
        store.update(query, doc, { upsert: true }, (err) => (err ? reject(err) : resolve())));

    // Crash reports are diagnostics the games' privacy policy keeps no longer than 24 months.
    // Player reports are evidence and are deleted by a person, never by age.
    async function prune() {
        if (!(cfg.retentionDays > 0)) return 0;
        const n = await remove(db, { timestamp: { $lt: Date.now() - cfg.retentionDays * DAY } }, true);
        if (n) log.log(`Pruned ${n} crash(es) older than ${cfg.retentionDays} days`);
        return n;
    }

    // Groups are computed, not stored: a few thousand crashes is nothing to fold in memory, and a
    // stored count is one more thing that can disagree with the crashes it counts.
    async function groups(query) {
        const crashes = await find(db, query, { timestamp: -1 });
        const marks = await find(groupDb, {});
        const markOf = new Map(marks.map((m) => [m.fingerprint, m]));
        const byFp = new Map();
        for (const c of crashes) {
            const fp = c.fingerprint || fingerprint(c.game || cfg.defaultGame, c.script || '', c.message || '');
            let g = byFp.get(fp);
            if (!g) {
                g = {
                    fingerprint: fp, game: c.game || cfg.defaultGame, message: c.message, script: c.script,
                    line: c.line, latestId: c._id, count: 0, lastSeen: c.timestamp, firstSeen: c.timestamp,
                    versions: [], platforms: [], sessions: new Set(),
                };
                byFp.set(fp, g);
            }
            g.count += c.repeats || 1;
            g.firstSeen = c.timestamp;
            const v = c.version || c.up_version;
            if (v && !g.versions.includes(v)) g.versions.push(v);
            const p = c.platform || (c.os && c.os.os_type !== undefined ? `os ${c.os.os_type}` : '');
            if (p && !g.platforms.includes(p)) g.platforms.push(p);
            if (c.session) g.sessions.add(c.session);
        }
        return [...byFp.values()].map((g) => {
            const m = markOf.get(g.fingerprint);
            // A resolved group that crashes again after it was resolved is open again: a fix that
            // did not fix it should not stay hidden under a tick.
            const status = m && m.resolvedAt && g.lastSeen <= m.resolvedAt ? 'resolved' : (m && m.resolvedAt ? 'regressed' : 'open');
            const out = Object.assign({}, g, { players: g.sessions.size, status });
            delete out.sessions;
            if (m && m.resolvedAt) out.resolvedAt = m.resolvedAt;
            return out;
        });
    }

    const app = express();
    app.set('trust proxy', cfg.trustProxy);
    app.disable('x-powered-by');
    if (cfg.staticDir) app.use(serveStatic(cfg.staticDir));
    // 256 KB: a GameMaker exception with a long stack trace is a few KB, and anything near this
    // is not a crash report.
    app.use(express.json({ limit: '256kb' }));

    const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
        log.error(err);
        res.status(500).send('Server error');
    });
    const gameFilter = (req) => {
        const q = {};
        if (typeof req.query.game === 'string' && req.query.game) q.game = req.query.game;
        return q;
    };

    app.get('/api/health', (req, res) => res.status(200).send({ ok: true }));

    // How the dashboard signs in: where to send the browser for Yotis, and whether the password works.
    app.get('/api/auth', (req, res) => res.status(200).send({
        yotis: cfg.yotis ? { signin: cfg.yotis.signin, service: cfg.yotis.service, callback: cfg.yotis.callback } : null,
        password: !!cfg.password,
    }));

    // Who the dashboard is signed in as.
    app.get('/api/me', requireAdmin, (req, res) => res.status(200).send(req.staff ? { name: req.staff.name, via: 'yotis' } : { via: cfg.password ? 'password' : 'open' }));

    // --- crashes ------------------------------------------------------------------------------

    // POST a crash. Open by necessity -- game clients have no credential to present -- so
    // everything defensive happens here.
    app.post('/api/crash', wrap(async (req, res) => {
        if (crashLimited(req.ip)) return res.status(429).send('Too many crashes');
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).send('Expected a JSON body');
        const game = gameOf(req.body);
        if (!game) return res.status(400).send('Unknown game');
        const crash = sanitiseCrash(req.body, game);
        crash.timestamp = Date.now();
        const doc = await insert(db, crash);
        log.log(`Crash(${doc._id}) ${game} ${crash.version} ${crash.fingerprint}: ${crash.message.split('\n')[0].slice(0, 120)}`);
        // The id and nothing else: echoing the stored document to an unauthenticated caller
        // would hand anyone a way to see what the server keeps.
        res.status(201).send({ id: doc._id });
    }));

    // Every crash, newest first, optionally one game's or one group's.
    app.get('/api/crash', requireAdmin, wrap(async (req, res) => {
        const q = gameFilter(req);
        if (typeof req.query.fingerprint === 'string' && req.query.fingerprint) q.fingerprint = req.query.fingerprint;
        const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
        res.status(200).send(await find(db, q, { timestamp: -1 }, limit));
    }));

    app.get('/api/crash/groups', requireAdmin, wrap(async (req, res) => {
        res.status(200).send(await groups(gameFilter(req)));
    }));

    // Mark a group resolved (body {resolved: true}) or reopen it ({resolved: false}).
    app.post('/api/crash/groups/:fp/resolve', requireAdmin, wrap(async (req, res) => {
        const fp = String(req.params.fp);
        const resolved = !req.body || req.body.resolved !== false;
        await upsert(groupDb, { fingerprint: fp }, { fingerprint: fp, resolvedAt: resolved ? Date.now() : null });
        res.status(200).send({ fingerprint: fp, resolved });
    }));

    // Delete every crash in a group, and its mark.
    app.delete('/api/crash/groups/:fp', requireAdmin, wrap(async (req, res) => {
        const fp = String(req.params.fp);
        const n = await remove(db, { fingerprint: fp }, true);
        await remove(groupDb, { fingerprint: fp }, true);
        log.log(`Removed group ${fp} (${n} crashes)`);
        res.status(200).send(String(n));
    }));

    app.delete('/api/crash/:id', requireAdmin, wrap(async (req, res) => {
        const n = await remove(db, { _id: String(req.params.id) }, false);
        log.log(`Removed crash(${req.params.id})`);
        res.status(200).send(String(n));
    }));

    // The games the dashboard can filter by: every game with a crash or report on file, plus the
    // configured list, so a game shows up before its first crash does.
    app.get('/api/games', requireAdmin, wrap(async (req, res) => {
        const stats = new Map();
        const at = (g) => {
            if (!stats.has(g)) stats.set(g, { game: g, crashes: 0, reports: 0, lastCrash: 0 });
            return stats.get(g);
        };
        for (const g of cfg.games) at(g);
        for (const c of await find(db, {}, null)) {
            const s = at(c.game || cfg.defaultGame);
            s.crashes += c.repeats || 1;
            s.lastCrash = Math.max(s.lastCrash, c.timestamp || 0);
        }
        for (const r of await find(reportDb, {}, null)) at(r.game || cfg.defaultGame).reports += 1;
        res.status(200).send([...stats.values()].sort((a, b) => a.game.localeCompare(b.game)));
    }));

    // --- player reports -----------------------------------------------------------------------
    //
    // A game with chat can mute a player locally and send a report here: the only route from
    // "somebody is being vile" to a human who can act on it, which is also what Google Play's
    // user-generated-content policy expects of an app carrying chat. Their own datastore rather
    // than snitch.db: crashes are diagnostics kept no longer than 24 months, a report contains
    // another player's words and is evidence.

    app.get('/api/report', requireAdmin, wrap(async (req, res) => {
        res.status(200).send(await find(reportDb, gameFilter(req), { timestamp: -1 }));
    }));

    app.post('/api/report', wrap(async (req, res) => {
        if (reportLimited(req.ip)) return res.status(429).send('Too many reports');
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).send('Expected a JSON body');
        const game = gameOf(req.body);
        if (!game) return res.status(400).send('Unknown game');
        const report = sanitiseReport(req.body, game);
        report.timestamp = Date.now();
        // From the connection (through the trusted proxy), never from the body: a reporter
        // cannot be allowed to choose what address their report appears to come from.
        report.reporterIp = String(req.ip || 'unknown').slice(0, 64);
        const doc = await insert(reportDb, report);
        log.log(`Report(${doc._id}) ${game} on "${report.reportedName}" from "${report.reporterName}"`);
        res.status(201).send();
    }));

    app.delete('/api/report/:id', requireAdmin, wrap(async (req, res) => {
        const n = await remove(reportDb, { _id: String(req.params.id) }, false);
        log.log(`Removed report(${req.params.id})`);
        res.status(200).send(String(n));
    }));

    // A malformed JSON body is the client's mistake, not the server's.
    app.use((err, req, res, next) => {
        if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
            return res.status(err.status || 400).send(err.type === 'entity.too.large' ? 'Too large' : 'Bad JSON');
        }
        next(err);
    });

    // Crashes and reports stored before games were told apart (and before crashes were sanitised)
    // are brought up to date once, on load: tagged with the default game so a game filter finds
    // them, fingerprinted so they group, and their OS info cut to the whitelist -- the old client
    // sent os_get_info whole, device identifiers included, and those should not stay on disk.
    async function migrate() {
        const update = (store, query, mod) => new Promise((resolve, reject) =>
            store.update(query, mod, { multi: true }, (err, n) => (err ? reject(err) : resolve(n))));
        const tagged = await update(db, { game: { $exists: false } }, { $set: { game: cfg.defaultGame } });
        const reports = await update(reportDb, { game: { $exists: false } }, { $set: { game: cfg.defaultGame } });
        let fixed = 0;
        const stale = (await find(db, {})).filter((c) => !c.fingerprint || typeof c.os === 'string');
        for (const c of stale) {
            const set = { fingerprint: fingerprint(c.game, str(c.script, 256), str(c.message, 1000) || 'Unknown crash') };
            const unset = {};
            if (typeof c.os === 'string') {
                const os = pickOs(c.os);
                if (os) set.os = os; else unset.os = true;
            }
            const mod = { $set: set };
            if (Object.keys(unset).length) mod.$unset = unset;
            await update(db, { _id: c._id }, mod);
            fixed += 1;
        }
        // nedb appends every update, so the old lines -- identifiers and all -- stay in the file
        // until it is rewritten.
        if (tagged || fixed) await db.compactDatafileAsync();
        if (reports) await reportDb.compactDatafileAsync();
        if (tagged || reports || fixed) log.log(`Migrated: ${tagged} crash(es) and ${reports} report(s) tagged ${cfg.defaultGame}, ${fixed} crash(es) fingerprinted or cleaned`);
    }

    let timer = null;
    return {
        app,
        prune,
        async start(port, host) {
            await load(db);
            await load(reportDb);
            await load(groupDb);
            await migrate();
            // Rewrite each file once a day: nedb appends every change, so a store with many
            // deletes grows without this.
            for (const store of [db, reportDb, groupDb]) store.setAutocompactionInterval(DAY);
            await prune();
            timer = setInterval(() => prune().catch((e) => log.error(e)), HOUR);
            timer.unref();
            return new Promise((resolve) => {
                const server = app.listen(port, host || undefined, () => resolve(server));
            });
        },
        stop() {
            if (timer) clearInterval(timer);
            for (const store of [db, reportDb, groupDb]) store.stopAutocompaction();
        },
    };
}

module.exports = { createServer, fingerprint, pickOs };
