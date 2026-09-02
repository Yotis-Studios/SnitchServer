# SnitchServer

A simple API and frontend for collecting and viewing crashes from [Snitch](https://github.com/JujuAdams/Snitch).

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

By default the app will run on port `3001`.

## Configuration

All optional, all read from the environment:

| variable | default | |
|---|---|---|
| `PORT` | `3001` | |
| `ADMIN_PASSWORD` | *(empty)* | **An empty value disables authentication.** `GET` and `DELETE` are then open to anyone who can reach the server, and crash reports contain device information. Set it. |
| `DB_PATH` | `./snitch.db` | crash reports |
| `REPORT_DB_PATH` | `./reports.db` | player reports, deliberately a separate store |
| `REPORT_RATE_LIMIT` | `20` | reports accepted per IP per hour |

The server prints a warning on startup when `ADMIN_PASSWORD` is unset.

## Client Setup

`snitch_sync.gml` is provided as an example of how to upload a crash to the server. You can simply change `postURL` to match your server's location then run `snitch_sync()` at your game's start.