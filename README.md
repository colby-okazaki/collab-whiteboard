# Collaborative Whiteboard

[![CI/CD](https://github.com/colby-okazaki/collab-whiteboard/actions/workflows/ci.yml/badge.svg)](https://github.com/colby-okazaki/collab-whiteboard/actions/workflows/ci.yml)

A real-time shared canvas where multiple users draw and collaborate at the same time and see each other's changes instantly.

**Live demo: https://collab-whiteboard-vhsh.onrender.com** (free hosting, so the app sleeps when nobody has used it for a while and the first visit afterwards is slow). Add `?board=anything` to the address for your own board.

**Stack:** React + Konva.js · Socket.io · Node.js/Express · PostgreSQL · Redis · Docker · Jest + React Testing Library

## Getting started

Requires Node.js 22+ and Docker.

```bash
npm install
cp server/.env.example server/.env
npm run db:up   # start PostgreSQL and Redis in Docker
npm run dev     # server on :4000 and client on :5173 together
```

Open the client in two browser windows to see changes sync, or click **share** to copy a link to the board you're on. Boards are saved to PostgreSQL and survive server restarts.

Both services are optional: without `DATABASE_URL` boards are kept in memory only, and without `REDIS_URL` the server runs as a single instance with live state in memory.

### Running the whole app in Docker

```bash
npm run docker:up    # builds the image and starts the app, PostgreSQL and Redis
```

Open http://localhost:8080. In this mode the server also serves the built client, so one container is the whole app. Stop it with `npm run docker:down`.

On SIGTERM (what hosts send when restarting or redeploying) the server stops accepting connections, saves any half-drawn strokes, waits for queued database writes, then exits, so a deploy doesn't lose what was just drawn. CI builds the image, starts the container, checks it serves the client and `/health`, and checks it exits cleanly when stopped.

### Running several server instances

With Redis configured, any number of server instances can serve the same boards:

```bash
cd server
PORT=4001 node --env-file=.env src/index.js
```

Then open `http://localhost:5173/?server=http://localhost:4001` next to a window on the default server (port 4000). Drawing, cursors, notes and locks all sync between the two.

### Tests

GitHub Actions runs the tests below on every push and pull request, against real PostgreSQL and Redis services (see CI/CD above).

```bash
npm test                            # unit and component tests
npm run test:integration -w server  # PostgreSQL, Redis and multi-instance tests (needs npm run db:up)
npm run coverage                    # coverage report
npm run bench -w server             # sync latency benchmark (needs a running server)
npm run bench:load -w server        # concurrent-user load test
npm run bench:races -w server       # conflict-resolution stress test
npm run bench:batching              # traffic saved by batching and throttling
```

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request:

1. **test**: unit and component tests, integration tests against real PostgreSQL and Redis service containers, and the client build.
2. **docker** (after `test` passes): builds the production image, starts the container, checks it serves the client and `/health`, and checks it exits cleanly on SIGTERM. On a push to `main` the verified image is then published to GitHub Container Registry as `ghcr.io/colby-okazaki/collab-whiteboard`, tagged with the commit (`sha-1234567`) and `latest`.
3. **deploy** (pushes to `main` only): calls a hosting provider's deploy hook. This does nothing until a `DEPLOY_HOOK_URL` secret is added to the repository, and it says so in its log. The Render deployment below does not need it: Render builds from the repository and is configured to deploy only after the checks pass.

Pull requests run the tests and the container check but never publish. New packages start private, so the image can be pulled by others only after its visibility is set to public in the package settings on GitHub. Once it is, run a published build with:

```bash
docker run -p 8080:4000 ghcr.io/colby-okazaki/collab-whiteboard:latest
```

## Deployment

The live demo runs on [Render](https://render.com), described by `render.yaml` (a Render Blueprint): one web service built from the `Dockerfile` (it serves the client and the websocket server together) and one PostgreSQL database, both on free plans. `DATABASE_URL` is wired from the database to the service by reference, so no password is stored in the repository. Redis is not used there, so the server runs as a single instance with live state in memory; boards are still saved to PostgreSQL and survive restarts. That was checked on the live site by restarting the service and reloading a board, and the server logs show the graceful shutdown running on the old instance. The service's `autoDeployTrigger: checksPass` setting makes Render deploy a push only after its GitHub checks pass.

Free-plan limits worth knowing: the web service sleeps when idle, and a free PostgreSQL database expires 30 days after it is created, so a demo that should last needs a paid database or a fresh one.

## Project layout

```
server/   Express + Socket.io server (also serves the built client in production)
  src/store/   live board state: in-memory or Redis, sharing one set of conflict rules
  src/db/      PostgreSQL persistence
client/   Vite + React + react-konva frontend
```

## Roadmap (v1)

- [x] Project scaffold, socket connection, join snapshot
- [x] Freehand pen + eraser + color picker
- [x] Shapes: line, rectangle and ellipse
- [x] Zoom and pan
- [x] Live stroke streaming (points batched every 40ms)
- [x] Sticky notes (add, edit, move)
- [x] Live cursors (throttled to 50ms)
- [x] No login: anyone can join, and each person gets their own color
- [x] Conflict resolution for concurrent edits/moves (locks + versioning)
- [x] PostgreSQL persistence for board state
- [x] Clear board, with a confirmation, wiping the board for every user
- [x] Undo and redo of your own strokes
- [x] Multiple boards: shareable links (`?board=name`) and a new board button
- [x] Export the board as a PNG
- [x] Touch drawing on phones and tablets
- [x] Stretch: Redis for multi-instance scaling

## Conflict resolution

Sticky notes use two layers of protection against concurrent edits:

1. **Locks for in-progress interactions.** Dragging or editing a note first acquires a lock on the server. Other users see the note outlined with the editor's name and cannot grab it until the lock is released (on drop, save, cancel, or disconnect). Locks expire after 60 seconds unless renewed, which the client does while the editor is open, so a crashed server or client can never leave a note stuck.
2. **Optimistic concurrency for commits.** Each commit includes the version it was based on. If the note changed since then (for example, the client had not yet received another user's commit), the server rejects the commit and the client rolls back to the authoritative state instead of silently overwriting someone else's work.

Drag positions are streamed to other users while dragging but are only stored once the move is committed.

## Persistence

The live board store (memory or Redis) stays the source of truth, so real-time sync never waits on the database. Changes are written to PostgreSQL in the background:

- **Strokes** are saved once when finished, not on every batch of points. Strokes left unfinished by a disconnect are saved too.
- **Notes** are saved when created and on every accepted commit. Saves use an upsert guarded by `WHERE notes.version < EXCLUDED.version`, so a delayed older write can never overwrite a newer one.
- **Boards** are loaded from the database the first time someone opens them after a restart. Concurrent joins share one load.

Locks and cursors are never stored; they only make sense while users are connected.

### Boards and sharing

The board comes from the address: `?board=team-sync` opens that board, and no parameter opens `default`. **new board** switches to a fresh random board and updates the address, so the back button returns to the previous one, and **share** copies the link (or shows it to copy by hand if the browser blocks clipboard access). Names follow the server's rules (letters, digits, `-` and `_`, up to 64 characters); anything else falls back to the default board. Each board has its own strokes, notes, locks and history, and anyone with the link can edit it, because there is deliberately no login.

### Shapes

The **line**, **rect** and **ellipse** tools draw a shape by dragging from one corner (or end) to the other, in any direction. You see it as you drag, but nothing is sent until you let go, and then the finished shape goes to the server in one message (two points, `[x1, y1, x2, y2]`) instead of being streamed like a pen stroke. A shape is stored as a stroke, so undo and redo, saving to PostgreSQL, sharing with other users, and exporting all work the same way. The server checks that a shape has exactly two points and that a streamed stroke can't claim to be a shape. A drag shorter than 3 pixels is ignored, so a plain click leaves nothing behind.

### Guests and colors

There is no login and no names: anyone who opens a link is in, and people are told apart by color. Each person on a board gets their own color, chosen by the server when they join: the first of 12 distinct colors that nobody there is using, and then colors spread around the colour wheel if a board has more people than that. A color is free again when its owner leaves. Because the server decides, two people can't end up with the same color, and a client can't claim someone else's (clients send only where their cursor is, and anything else is ignored). Each person's cursor is an ordinary arrow pointer with an outline in their color, on everyone else's screen (its tip is exactly where they are pointing), and it stays the same size however far you zoom, and is the color of the dashed border and "editing" label on a note they are editing. Your own mouse pointer is the same outlined arrow, so you can see what others see. Nothing about a person is stored.

### Zoom and pan

**Ctrl or Cmd + wheel** (and a trackpad pinch) zooms around the pointer, so whatever is under the mouse stays under it, and a plain wheel or two-finger scroll pans. The **hand** tool drags the board around, and the toolbar has zoom out, zoom in and reset buttons that show the current percentage (10% to 500%). Everything is sent in board coordinates, not screen coordinates (`client/src/utils/view.js` converts between the two), so strokes, shapes, notes and your cursor land in the right place for every user however far each of them has zoomed or panned. The note editor follows the zoomed note. Your view is yours: it is not shared or saved. Touch panning works with the hand tool, but pinch-to-zoom on a phone is not handled yet.

### Export and touch

**export png** downloads the board as `whiteboard-<board>.png` at twice the screen resolution, so it stays sharp when zoomed. The image has the paper-coloured background and contains the strokes and notes; other people's cursors are hidden for the capture. It saves what is in the window, at the current zoom and position. Drawing also works with a finger: touch input is handled like the mouse, and the browser's own scrolling and zooming are switched off over the board. The toolbar wraps on narrow screens. Touch has been tried with simulated touch events, not a real phone.

### Undo and redo

Cmd/Ctrl+Z undoes your last stroke, Shift+Cmd/Ctrl+Z (or Ctrl+Y) redoes it, and the toolbar has buttons for both. It steps back through your last 50 strokes, and only your own: the server remembers which socket drew each stroke and ignores an undo for anyone else's. Undoing removes the stroke for every user and deletes it from PostgreSQL, so it stays gone after a restart. Redo sends the whole stroke back in one message (allowed up to 10,000 points, more than a normal batch) and it returns on top of the board. Drawing something new clears the redo history, as does clearing the board. While typing in a note, the browser keeps its own text undo.

### Clearing a board

The **clear board** button asks for confirmation in a dialog inside the page (not the browser's own `confirm()` popup, which embedded browsers and some privacy settings block, leaving the button apparently doing nothing). Cancel is focused first, Escape or clicking outside backs out, and confirming wipes the board for every connected user: the live state (memory or Redis) is emptied, the board's rows are deleted from PostgreSQL in a single statement, and every client is told to reset, including dropping any half-drawn stroke or open note editor. Database writes for a board run in order, so a slow save from just before a clear can't land afterwards and bring deleted content back after a restart. Late messages about cleared content (extra stroke points, note commits) find nothing to attach to and are dropped.

## Input validation

The server doesn't trust clients. Every socket payload is checked in `server/src/validate.js` before it touches a store, and anything malformed is dropped (writes that expect a reply get `{ ok: false, reason: 'invalid' }`):

- Board and object IDs must be short strings of letters, digits, `-` and `_`, which also keeps user input out of Redis key names.
- Coordinates must be finite numbers within bounds, stroke batches are capped (400 values per message), and colors, tools and text lengths are checked.
- Only known fields are copied through, so clients can't inject extra properties such as a note's `version` or `lockedBy`.

### Rate limiting

Each connection gets a token bucket (`server/src/rateLimit.js`): a burst of 200 messages, then 100 a second on average. Real use stays far below that, since cursor moves are throttled to 20 a second and stroke points are batched about every 40ms, so only a client that floods the server hits it. Excess messages are dropped before any validation or store work is spent on them, and writes that expect a reply get `{ ok: false, reason: 'rate_limited' }`. One client's flood doesn't slow anyone else, because each connection has its own bucket. The server logs how many messages it dropped when that client disconnects. Tune it with `RATE_LIMIT_CAPACITY` and `RATE_LIMIT_PER_SECOND`.

## Measured results

All numbers come from the scripts in this repo. Unless a row says otherwise they were measured on a single laptop, with the load generator, both server instances, PostgreSQL and Redis all running on it. That makes them a fair test of the server and the Redis hop, but they exclude internet delay, so real-world latency is these numbers plus the network round trip. The sync latency table has one row measured against the live deployment.

### Sync latency

`npm run bench -w server` times a message from one user, through the server, to another (500 messages per run):

| Path | p50 | p99 |
|---|---|---|
| Both users on one server | 0.9 - 1.3 ms | 1.6 - 4.5 ms |
| Users on two different servers (via Redis) | 2.0 - 2.9 ms | 4.4 - 8.3 ms |
| Over the internet: this laptop to the live Render deployment (Oregon) and back | 44.7 - 46.4 ms | 113.7 - 121.1 ms |

The ranges cover separate runs (two for the local rows, three for the internet row, 500 messages each, all delivered). The internet row sends from one connection and receives on another, both over the internet, so it includes both trips; it was run with `npm run bench -w server -- --from https://collab-whiteboard-vhsh.onrender.com --to https://collab-whiteboard-vhsh.onrender.com` and the app is on a shared free instance, so expect it to vary with your connection and distance from Oregon.

### Concurrent users

`npm run bench:load -w server` connects many users to one board and has some of them move their cursor at 20 updates a second (the rate the client sends). Users are spread across two server instances, so deliveries cross the Redis hop. Every run delivered 100% of messages.

| Connected users | Moving | Deliveries per second | p50 | p95 | p99 |
|---|---|---|---|---|---|
| 50 | 10 | 9,555 | 4.4 ms | 12.1 ms | 17.1 ms |
| 100 | 20 | 38,422 | 9.6 ms | 17.9 ms | 39.8 ms |
| 200 | 20 | 77,610 | 5.5 ms | 16.2 ms | 24.7 ms |
| 500 | 10 | 97,804 | 11.5 ms | 22.2 ms | 31.7 ms |
| 300 | 30 | 173,988 | 12.1 ms | 42.4 ms | 184.6 ms |

Up to 500 connected users, p99 stayed under 40 ms. At 300 users with 30 of them moving (174k deliveries a second), p99 rose above the ~100 ms target, which is where this setup starts to saturate.

### Conflict resolution under stress

`npm run bench:races -w server` has 10 users on two server instances grab the same sticky note at the same instant, 500 times (5,000 simultaneous lock attempts). Each trial checks that exactly one user gets the lock, that nobody else can commit while it is held, that the holder's commit is accepted, that a commit based on an old version is rejected as stale, and that the note ends up exactly as the holder left it. Trials are paced 40ms apart (`--pace`) so the test stays under the per-connection rate limit; if it is ever limited, it stops with an error instead of reporting false conflicts. Result: 0 violations across all checks, with the rate limiter on.

To confirm the test can fail, it was also run against a server patched to grant every lock; that run reported violations in every trial and exited with an error.

### Traffic saved by batching and throttling

`npm run bench:batching` drives the client's real batching and throttling code with simulated mouse input for 4 seconds:

| Input rate | Stroke point messages | Cursor messages | Cursor bytes |
|---|---|---|---|
| 60 Hz | 66% fewer | 66% fewer | 66% less |
| 120 Hz | 80% fewer | 82% fewer | 82% less |

Payload bytes for stroke points are 29-35% lower. Byte counts cover the JSON payload only; socket framing would add to the unbatched side.

### Tests and coverage

`npm test` runs 347 tests (178 server, 169 client), and `npm run coverage` reports coverage:

| | Statements | Lines | Functions | Branches |
|---|---|---|---|---|
| Server | 84% | 85% | 90% | 80% |
| Client | 99% | 99% | 99% | 86% |

The server figure includes the integration tests that run against real PostgreSQL and Redis. The uncovered server code is mostly `index.js`, the startup and signal-handling entry point, which is checked by CI starting the real container instead. Client tests cover drawing, streamed updates from other users, note dragging and editing (including lock denials, rolled-back commits and lock renewal), clearing the board, undo and redo, and switching and sharing boards, touch drawing, drawing shapes, zooming and panning, cursor colors, and exporting an image. Server tests also cover rate limiting. The one client file with no coverage is `socket.js`, which reads Vite's `import.meta` and can't be loaded under Jest. The component tests replace the Konva canvas with plain elements, so they check behavior rather than pixels.

The app is about 1,900 lines of source across 25 files, plus about 3,300 lines of tests.

## Scaling across instances

A single server keeps live state in memory. With `REDIS_URL` set, every instance shares state through Redis instead:

- **Broadcasts** go through the Socket.io Redis adapter, so an event from a user on one instance reaches users on all of them.
- **Live state** (strokes, notes, locks) lives in Redis, keyed per board with a `{boardId}` hash tag so each board stays on one Redis Cluster slot.
- **Conflict checks are atomic.** Locking, committing, unlocking and releasing a note each run as a single Lua script, so two instances can't both grant the same lock. Lock expiry uses Redis server time so instances with skewed clocks still agree.
- **Loading from PostgreSQL** happens once per board: the first instance to load it seeds Redis, and later attempts are no-ops.

Both store implementations run the same contract test suite, and an integration test starts multiple instances in one process and checks that strokes, locks, stale commits, and disconnects behave correctly when users are on different instances.

**Out of scope:** layers/vector shapes, undo/redo, auth/permissions, mobile, Figma-level features.
