const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer, fingerprint } = require('../lib/server');

// Each test gets a server on a random port with its own throwaway files.
async function boot(t, config) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snitch-'));
    const quiet = { log() {}, error() {} };
    const s = createServer(Object.assign({
        dbPath: path.join(dir, 'snitch.db'),
        reportDbPath: path.join(dir, 'reports.db'),
        groupDbPath: path.join(dir, 'groups.db'),
        password: 'pw',
        games: ['raifuwars', 'biplanebattle'],
        log: quiet,
    }, config));
    const http = await s.start(0, '127.0.0.1');
    const base = `http://127.0.0.1:${http.address().port}`;
    t.after(() => {
        s.stop();
        http.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const call = async (method, url, body, admin = true) => {
        const headers = {};
        if (admin) headers.Authorization = 'pw';
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch (e) { json = undefined; }
        return { status: res.status, json, text };
    };
    return { call, server: s };
}

const crash = (o) => Object.assign({
    game: 'biplanebattle', version: '0.3.0', message: 'Variable oPlane.hp(100234) not set before reading it.',
    longMessage: 'ERROR in action ...', script: 'gml_Script_bb_simStep', line: 120,
    stacktrace: ['gml_Script_bb_simStep (line 120)', 'gml_Object_oMatch_Step_0 (line 3)'],
}, o);

test('a crash is stored with its game and sanitised', async (t) => {
    const { call } = await boot(t);
    const r = await call('POST', '/api/crash', crash({ evil: 'x'.repeat(10), stacktrace: Array(100).fill('frame'), os: { os_type: 0, udid: 'secret-id' } }), false);
    assert.strictEqual(r.status, 201);
    assert.ok(r.json.id);
    assert.deepStrictEqual(Object.keys(r.json), ['id'], 'the reply echoes nothing but the id');
    const list = (await call('GET', '/api/crash')).json;
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].game, 'biplanebattle');
    assert.strictEqual(list[0].evil, undefined, 'unknown keys are dropped');
    assert.strictEqual(list[0].stacktrace.length, 64, 'the stack is capped');
    assert.deepStrictEqual(list[0].os, { os_type: 0 }, 'only whitelisted os fields are kept');
});

test('an old Raifu Wars crash (no game, os as a JSON string) belongs to raifuwars', async (t) => {
    const { call } = await boot(t);
    const body = crash({ os: JSON.stringify({ os_type: 0, os_version: 655360, udid: 'x' }), up_version: '1.14.0a', uncaught: true });
    delete body.game;
    assert.strictEqual((await call('POST', '/api/crash', body, false)).status, 201);
    const [c] = (await call('GET', '/api/crash')).json;
    assert.strictEqual(c.game, 'raifuwars');
    assert.deepStrictEqual(c.os, { os_type: 0, os_version: 655360 });
    assert.strictEqual(c.uncaught, true);
});

test('unknown or malformed game ids are refused', async (t) => {
    const { call } = await boot(t);
    assert.strictEqual((await call('POST', '/api/crash', crash({ game: 'notagame' }), false)).status, 400);
    assert.strictEqual((await call('POST', '/api/crash', crash({ game: 'Bad Id!' }), false)).status, 400);
    assert.strictEqual((await call('POST', '/api/report', { game: 'notagame', reportedName: 'x' }, false)).status, 400);
    assert.strictEqual((await call('POST', '/api/crash', '{not json', false)).status, 400);
    assert.strictEqual((await call('POST', '/api/crash', [1, 2], false)).status, 400);
});

test('an empty games list accepts any well-formed id', async (t) => {
    const { call } = await boot(t, { games: [] });
    assert.strictEqual((await call('POST', '/api/crash', crash({ game: 'anything-new' }), false)).status, 201);
    assert.strictEqual((await call('POST', '/api/crash', crash({ game: 'NOPE' }), false)).status, 400);
});

test('admin routes need the password; ingest does not', async (t) => {
    const { call } = await boot(t);
    for (const [m, u] of [['GET', '/api/crash'], ['GET', '/api/crash/groups'], ['GET', '/api/games'], ['GET', '/api/report'],
        ['DELETE', '/api/crash/x'], ['DELETE', '/api/report/x'], ['DELETE', '/api/crash/groups/x'], ['POST', '/api/crash/groups/x/resolve']]) {
        assert.strictEqual((await call(m, u, m === 'POST' ? {} : undefined, false)).status, 401, `${m} ${u}`);
    }
    assert.strictEqual((await call('GET', '/api/health', undefined, false)).status, 200);
});

test('the same error groups across versions, lines and instance ids', async (t) => {
    const { call } = await boot(t);
    await call('POST', '/api/crash', crash({ session: 'a' }), false);
    await call('POST', '/api/crash', crash({ version: '0.3.1', line: 131, message: 'Variable oPlane.hp(100999) not set before reading it.', session: 'b' }), false);
    await call('POST', '/api/crash', crash({ session: 'b', repeats: 3 }), false);
    await call('POST', '/api/crash', crash({ message: 'Division by zero' }), false);
    await call('POST', '/api/crash', crash({ game: 'raifuwars' }), false);
    const all = (await call('GET', '/api/crash/groups')).json;
    assert.strictEqual(all.length, 3, 'two errors in one game, one in another');
    const g = all.find((x) => x.game === 'biplanebattle' && x.message.startsWith('Variable'));
    assert.strictEqual(g.count, 5, 'repeats are counted');
    assert.strictEqual(g.players, 2);
    assert.deepStrictEqual(g.versions.sort(), ['0.3.0', '0.3.1']);
    assert.strictEqual(g.status, 'open');
    const one = (await call('GET', '/api/crash/groups?game=raifuwars')).json;
    assert.strictEqual(one.length, 1);
    const ofGroup = (await call('GET', `/api/crash?fingerprint=${g.fingerprint}`)).json;
    assert.strictEqual(ofGroup.length, 3);
});

test('a resolved group reopens as regressed when it crashes again', async (t) => {
    const { call } = await boot(t);
    await call('POST', '/api/crash', crash(), false);
    const [g] = (await call('GET', '/api/crash/groups')).json;
    assert.strictEqual((await call('POST', `/api/crash/groups/${g.fingerprint}/resolve`, { resolved: true })).status, 200);
    assert.strictEqual((await call('GET', '/api/crash/groups')).json[0].status, 'resolved');
    await new Promise((r) => setTimeout(r, 5));
    await call('POST', '/api/crash', crash(), false);
    assert.strictEqual((await call('GET', '/api/crash/groups')).json[0].status, 'regressed');
    await call('POST', `/api/crash/groups/${g.fingerprint}/resolve`, { resolved: false });
    assert.strictEqual((await call('GET', '/api/crash/groups')).json[0].status, 'open');
    assert.strictEqual((await call('DELETE', `/api/crash/groups/${g.fingerprint}`)).text, '2');
    assert.strictEqual((await call('GET', '/api/crash')).json.length, 0);
});

test('games lists configured games and counts', async (t) => {
    const { call } = await boot(t);
    await call('POST', '/api/crash', crash(), false);
    await call('POST', '/api/report', { reportedName: 'x', lines: ['hi'] }, false);
    const games = (await call('GET', '/api/games')).json;
    assert.deepStrictEqual(games.map((g) => [g.game, g.crashes, g.reports]), [['biplanebattle', 1, 0], ['raifuwars', 0, 1]]);
});

test('crashes are rate limited per address', async (t) => {
    const { call } = await boot(t, { crashRateLimit: 3 });
    for (let i = 0; i < 3; i++) assert.strictEqual((await call('POST', '/api/crash', crash(), false)).status, 201);
    assert.strictEqual((await call('POST', '/api/crash', crash(), false)).status, 429);
});

test('reports carry the game and the address from the connection, not the body', async (t) => {
    const { call } = await boot(t);
    const r = await call('POST', '/api/report', { game: 'biplanebattle', reportedName: 'x', reporterIp: '6.6.6.6', lines: ['a'] }, false);
    assert.strictEqual(r.status, 201);
    const [rep] = (await call('GET', '/api/report?game=biplanebattle')).json;
    assert.strictEqual(rep.game, 'biplanebattle');
    assert.notStrictEqual(rep.reporterIp, '6.6.6.6');
});

test('old crashes are pruned', async (t) => {
    const { call, server } = await boot(t, { retentionDays: 1 });
    await call('POST', '/api/crash', crash(), false);
    assert.strictEqual(await server.prune(), 0);
    const realNow = Date.now;
    Date.now = () => realNow() + 2 * 24 * 60 * 60 * 1000;
    try { assert.strictEqual(await server.prune(), 1); } finally { Date.now = realNow; }
});

test('crashes and reports from before games are migrated on load', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snitch-legacy-'));
    // nedb's on-disk format: one JSON document per line.
    fs.writeFileSync(path.join(dir, 'snitch.db'), [
        { _id: 'a1', message: 'old crash', script: 's', line: 1, stacktrace: [], os: '{"os_type":0,"udid":"device-id"}', timestamp: Date.now() },
        { _id: 'a2', message: 'old crash', script: 's', line: 2, stacktrace: [], os: 'not json', timestamp: Date.now() },
    ].map((d) => JSON.stringify(d)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'reports.db'), JSON.stringify({ _id: 'r1', kind: 'player_report', reportedName: 'x', lines: [], timestamp: Date.now() }) + '\n');
    const { call } = await boot(t, { dbPath: path.join(dir, 'snitch.db'), reportDbPath: path.join(dir, 'reports.db') });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const crashes = (await call('GET', '/api/crash?game=raifuwars')).json;
    assert.strictEqual(crashes.length, 2);
    const a1 = crashes.find((c) => c._id === 'a1');
    assert.deepStrictEqual(a1.os, { os_type: 0 }, 'the device id is gone from disk');
    assert.strictEqual(crashes.find((c) => c._id === 'a2').os, undefined);
    assert.strictEqual(a1.fingerprint, crashes.find((c) => c._id === 'a2').fingerprint);
    assert.strictEqual((await call('GET', '/api/report?game=raifuwars')).json.length, 1);
    assert.ok(!fs.readFileSync(path.join(dir, 'snitch.db'), 'utf8').includes('device-id'), 'the file was compacted after the migration');
});

test('fingerprints ignore version-specific noise but not the error', () => {
    assert.strictEqual(fingerprint('g', 's', 'x(100234) bad'), fingerprint('g', 's', 'x(999999) bad'));
    assert.strictEqual(fingerprint('g', 's', 'at 0x7ffde12'), fingerprint('g', 's', 'at 0x1'));
    assert.notStrictEqual(fingerprint('g', 's', 'a'), fingerprint('g', 's', 'b'));
    assert.notStrictEqual(fingerprint('g', 's', 'a'), fingerprint('h', 's', 'a'));
});
