const express = require('express');
const serveStatic = require('serve-static');

const app = express();

// CONFIGURED FROM THE ENVIRONMENT, not from a tracked file.
//
// This repository used to carry a config.js holding the admin password, which is why it was
// removed when the history was squashed for GitHub. Removing it took the AUTHENTICATION with it,
// though -- every crash route was left open, so anyone deploying this got a crash database the
// public could read and delete from. Environment variables give back the configurability without
// putting a secret in the repository.
//
// The defaults match what the file previously hardcoded, so an existing deployment behaves the
// same if nothing is set.
const appPort = process.env.PORT || 3001;
const password = process.env.ADMIN_PASSWORD || '';
const dbPath = process.env.DB_PATH || './snitch.db';
const reportDbPath = process.env.REPORT_DB_PATH || './reports.db';
const reportRateLimit = parseInt(process.env.REPORT_RATE_LIMIT || '20', 10);

// @seald-io/nedb, not nedb. The original was last published in February 2016 and calls
// util.isDate, which Node removed in v22 -- so on a current Node every insert throws and the API
// returns 500. The fork is a drop-in with the same on-disk format: verified by reading an existing
// snitch.db back through it, records intact, no migration.
const Datastore = require('@seald-io/nedb');
const db = new Datastore({ filename: dbPath });
const reportDb = new Datastore({ filename: reportDbPath });

// Shared by every route that must not be public, so the two cannot drift apart. They already had:
// GET checked a header and DELETE checked nothing at all, so any crash record could be removed by
// anyone who could reach the host.
//
// An EMPTY password disables the check, which keeps local development easy -- and is exactly why
// the server warns about it on boot rather than leaving it to be discovered.
function requireAdmin(req, res) {
    if (!password) return true;
    if (req.headers.authorization !== password) {
        res.status(401).send('Unauthorized');
        return false;
    }
    return true;
}

// Per-IP hourly cap on reports. In memory on purpose: this exists to stop somebody leaning on the
// report button, not to survive a restart, and a dependency-free counter is proportionate to that.
const reportHits = new Map();
function reportRateLimited(ip) {
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const hits = (reportHits.get(ip) || []).filter((t) => now - t < hour);
    if (hits.length >= reportRateLimit) {
        reportHits.set(ip, hits);
        return true;
    }
    hits.push(now);
    reportHits.set(ip, hits);
    return false;
}

// A report arrives from a game client, so nothing in it is trustworthy. Rebuilt field by field
// rather than stored as sent: an unbounded body on an unauthenticated endpoint is how a small nedb
// file becomes a large one, and storing arbitrary client keys would let a caller shape the
// documents the admin page later renders.
function sanitiseReport(body) {
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    const lines = Array.isArray(body.lines) ? body.lines.slice(0, 20) : [];
    return {
        kind: 'player_report',
        version: str(body.version, 32),
        reporterUid: str(body.reporterUid, 64),
        reporterName: str(body.reporterName, 64),
        reportedSlot: Number.isFinite(body.reportedSlot) ? body.reportedSlot : -1,
        reportedName: str(body.reportedName, 64),
        server: str(body.server, 128),
        lines: lines.map((l) => str(l, 280)),
    };
}

db.loadDatabase((err) => {
    // exit if database fails to load
    if (err) {
        console.error(err);
        return -1;
    }
    console.log('Loaded database');

    if (!password) {
        console.warn('WARNING: ADMIN_PASSWORD is not set -- GET and DELETE are unauthenticated');
    }

    reportDb.loadDatabase((reportErr) => {
        if (reportErr) {
            console.error(reportErr);
            return -1;
        }
        console.log('Loaded report database');

        // serve static files (Vue app)
        app.use(serveStatic(__dirname + "/app/dist"));

        // REST API (consumes JSON)
        app.use(express.json());

        // GET all crash reports sorted by latest first
        app.get('/api/crash', (req, res) => {
            if (!requireAdmin(req, res)) return;
            db.find({}).sort({ timestamp: -1 }).exec((err, docs) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send(err);
                }
                res.status(200).send(docs);
            });
        });

        // POST a new crash report. Open by necessity -- it is called by game clients, which have
        // no credential to present.
        app.post('/api/crash', (req, res) => {
            const timestamp = Date.now();
            const snitchCrash = req.body;
            snitchCrash.timestamp = timestamp;
            console.log(snitchCrash);
            db.insert(snitchCrash, (err, newDoc) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send(err);
                }
                console.log(`Added new crash(${newDoc._id}) into database`);
                res.status(201).send(newDoc);
            });
        });

        // DELETE crash report by id
        app.delete('/api/crash/:id', (req, res) => {
            if (!requireAdmin(req, res)) return;
            const id = req.params.id;
            db.remove({ _id: id }, {}, (err, numRemoved) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send(err);
                }
                console.log(`Removed crash(${id}) from database`);
                res.status(200).send(numRemoved.toString());
            });
        });

        // --- player reports -------------------------------------------------------------------
        //
        // Raifu Wars relays free-text chat between clients and moderates none of it, so the game
        // can mute a player locally and send a report here. This endpoint is the only route from
        // "somebody is being vile" to a human who can act on it, which is also what Google Play's
        // user-generated-content policy expects of an app carrying chat.
        //
        // Their own datastore rather than snitch.db: crash reports are diagnostics the game's
        // privacy policy commits to keeping no longer than 24 months, while an abuse report
        // contains another player's words and is evidence. Sharing a file would make separating
        // them later a migration instead of a config change.

        // GET every report, newest first. Admin only -- these contain another player's chat.
        app.get('/api/report', (req, res) => {
            if (!requireAdmin(req, res)) return;
            reportDb.find({}).sort({ timestamp: -1 }).exec((err, docs) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send(err);
                }
                res.status(200).send(docs);
            });
        });

        // POST a report. Unauthenticated for the same reason /api/crash is, so everything
        // defensive happens here.
        app.post('/api/report', (req, res) => {
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
            if (reportRateLimited(ip)) {
                return res.status(429).send('Too many reports');
            }
            if (!req.body || typeof req.body !== 'object') {
                return res.status(400).send('Expected a JSON body');
            }

            const report = sanitiseReport(req.body);
            report.timestamp = Date.now();
            // Recorded server-side, never taken from the body: a reporter cannot be allowed to
            // choose what address their report appears to come from.
            report.reporterIp = String(ip).slice(0, 64);

            reportDb.insert(report, (err, newDoc) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send(err);
                }
                console.log(`Report(${newDoc._id}) on "${report.reportedName}" from "${report.reporterName}"`);
                // 201 and an empty body. The client only needs to know it landed, and echoing the
                // stored document back to an unauthenticated caller would hand anyone a way to
                // confirm what the server keeps.
                res.status(201).send();
            });
        });

        // DELETE a report once it has been dealt with.
        app.delete('/api/report/:id', (req, res) => {
            if (!requireAdmin(req, res)) return;
            const id = req.params.id;
            reportDb.remove({ _id: id }, {}, (err, numRemoved) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send(err);
                }
                console.log(`Removed report(${id}) from database`);
                res.status(200).send(numRemoved.toString());
            });
        });

        app.listen(appPort, () => {
            console.log(`Snitch Server running on port ${appPort}`);
        });
    });
});
