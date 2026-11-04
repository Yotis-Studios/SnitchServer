# SnitchServer

An API and dashboard for collecting and viewing crashes and player reports from every Yotis Studios game: Raifu Wars (through [Snitch](https://github.com/JujuAdams/Snitch)) and every Ganbatte Engine game (through `gbe_crash`). Each crash carries its game id; the dashboard filters by game and groups the same error from every player and version into one row.

## Setup

Install the latest version of [NodeJS](https://nodejs.org/) on your machine. Then open a terminal window at the project directory and install dependencies with:

```
npm i
```

The frontend app also needs to be built:
```
cd app
npm i
npm run build
```

## Run

From the root project directory:
```
node snitch.js
```

By default the app runs on port `3001`. `npm test` runs the API tests (Node 18 or later, no extra dependencies).

## Configuration

All optional, all read from the environment:

| variable | default | |
|---|---|---|
| `PORT` | `3001` | |
| `HOST` | *(all interfaces)* | Set `127.0.0.1` behind nginx so the port is not reachable directly. |
| `ADMIN_PASSWORD` | *(empty)* | **An empty value disables authentication.** Every `GET`, `DELETE` and resolve is then open to anyone who can reach the server, and crashes contain device information. Set it. |
| `GAMES` | *(empty)* | Comma-separated game ids accepted, e.g. `raifuwars,biplanebattle`. A crash or report naming another game is refused (400). Empty accepts any well-formed id, and the server warns on boot. |
| `DEFAULT_GAME` | `raifuwars` | The game of a crash or report sent without a game id (Raifu Wars clients from before ids existed). |
| `DB_PATH` | `./snitch.db` | crashes |
| `REPORT_DB_PATH` | `./reports.db` | player reports, deliberately a separate store |
| `GROUP_DB_PATH` | `./groups.db` | which crash groups are resolved |
| `CRASH_RATE_LIMIT` | `60` | crashes accepted per IP per hour |
| `REPORT_RATE_LIMIT` | `20` | reports accepted per IP per hour |
| `RETENTION_DAYS` | `730` | crashes older than this are deleted hourly (the privacy policy's 24 months); `0` keeps them. Reports are never deleted by age. |
| `TRUST_PROXY` | `loopback` | Express `trust proxy`: whose `X-Forwarded-For` is believed for the client address. |

## API

Open (game clients have no credential): `POST /api/crash`, `POST /api/report`, `GET /api/health`.

Admin (`Authorization: <ADMIN_PASSWORD>`): `GET /api/crash?game=&fingerprint=&limit=`, `GET /api/crash/groups?game=`,
`POST /api/crash/groups/:fingerprint/resolve` (`{"resolved": false}` reopens), `DELETE /api/crash/groups/:fingerprint`,
`DELETE /api/crash/:id`, `GET /api/games`, `GET /api/report?game=`, `DELETE /api/report/:id`.

A crash body is a GameMaker exception struct (`message`, `longMessage`, `script`, `line`, `stacktrace`) plus, all optional:
`game`, `version`, `environment`, `platform`, `engine`, `session` (a per-run id, for counting players), `context`,
`uncaught`, `repeats`, `os`. Anything else is dropped; strings are capped; `os` keeps only a whitelist of fields
(no device identifiers). The same error is grouped by game, script and message with long numbers removed, so
it spans versions and line moves. A resolved group that crashes again shows as **regressed**.

## Client Setup

Ganbatte Engine games report through the engine's `gbe_crash` service: set `crash_api` in the game's manifest.
`snitch_sync.gml` is the older Snitch example: change `postURL` and run `snitch_sync()` at the game's start.