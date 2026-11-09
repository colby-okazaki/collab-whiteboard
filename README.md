# Collaborative Whiteboard

[![CI](https://github.com/Coa1B/collab-whiteboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Coa1B/collab-whiteboard/actions/workflows/ci.yml)

A real-time shared canvas where multiple users draw and collaborate at the same time and see each other's changes instantly.

**Stack:** React + Konva.js · Socket.io · Node.js/Express · PostgreSQL · Redis · Docker · Jest + React Testing Library

## Getting started

Requires Node.js 22+ and Docker.

```bash
npm install
cp server/.env.example server/.env
npm run db:up   # start PostgreSQL and Redis in Docker
npm run dev     # server on :4000 and client on :5173 together
```

Open the client in two browser windows to see changes sync. Boards are saved to PostgreSQL and survive server restarts.

Both services are optional: without `DATABASE_URL` boards are kept in memory only, and without `REDIS_URL` the server runs as a single instance with live state in memory.

### Running the whole app in Docker

```bash
npm run docker:up    # builds the image and starts the app, PostgreSQL and Redis
```

Open http://localhost:8080. In this mode the server also serves the built client, so one container is the whole app. Stop it with `npm run docker:down`.

### Running several server instances

With Redis configured, any number of server instances can serve the same boards:

```bash
cd server
PORT=4001 node --env-file=.env src/index.js
```

Then open `http://localhost:5173/?server=http://localhost:4001` next to a window on the default server (port 4000). Drawing, cursors, notes and locks all sync between the two.

### Tests

GitHub Actions runs everything below on every push and pull request, against real PostgreSQL and Redis services.

```bash
npm test                            # unit and component tests
npm run test:integration -w server  # PostgreSQL, Redis and multi-instance tests (needs npm run db:up)
npm run coverage                    # coverage report
npm run bench -w server             # sync latency benchmark (needs a running server)
npm run bench:load -w server        # concurrent-user load test
npm run bench:races -w server       # conflict-resolution stress test
npm run bench:batching              # traffic saved by batching and throttling
```

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
- [x] Live stroke streaming (points batched every 40ms)
- [x] Sticky notes (add, edit, move)
- [x] Live cursors (throttled to 50ms)
- [x] Conflict resolution for concurrent edits/moves (locks + versioning)
- [x] PostgreSQL persistence for board state
- [x] Clear board, with a confirmation, wiping the board for every user
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

### Clearing a board

The **clear board** button asks for confirmation, then wipes the board for every connected user: the live state (memory or Redis) is emptied, the board's rows are deleted from PostgreSQL in a single statement, and every client is told to reset, including dropping any half-drawn stroke or open note editor. Database writes for a board run in order, so a slow save from just before a clear can't land afterwards and bring deleted content back after a restart. Late messages about cleared content (extra stroke points, note commits) find nothing to attach to and are dropped.

## Input validation

The server doesn't trust clients. Every socket payload is checked in `server/src/validate.js` before it touches a store, and anything malformed is dropped (writes that expect a reply get `{ ok: false, reason: 'invalid' }`):

- Board and object IDs must be short strings of letters, digits, `-` and `_`, which also keeps user input out of Redis key names.
- Coordinates must be finite numbers within bounds, stroke batches are capped (400 values per message), and colors, tools and text lengths are checked.
- Only known fields are copied through, so clients can't inject extra properties such as a note's `version` or `lockedBy`.

## Measured results

All numbers come from the scripts in this repo and were measured on a single laptop, with the load generator, both server instances, PostgreSQL and Redis all running on it. That makes them a fair test of the server and the Redis hop, but they exclude internet delay, so real-world latency is these numbers plus the network round trip.

### Sync latency

`npm run bench -w server` times a message from one user, through the server, to another (500 messages per run):

| Path | p50 | p99 |
|---|---|---|
| Both users on one server | 0.9 - 1.3 ms | 1.6 - 4.5 ms |
| Users on two different servers (via Redis) | 2.0 - 2.9 ms | 4.4 - 8.3 ms |

The ranges cover two separate runs.

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

`npm run bench:races -w server` has 10 users on two server instances grab the same sticky note at the same instant, 500 times (5,000 simultaneous lock attempts). Each trial checks that exactly one user gets the lock, that nobody else can commit while it is held, that the holder's commit is accepted, that a commit based on an old version is rejected as stale, and that the note ends up exactly as the holder left it. Result: 0 violations across all checks.

To confirm the test can fail, it was also run against a server patched to grant every lock; that run reported violations in every trial and exited with an error.

### Traffic saved by batching and throttling

`npm run bench:batching` drives the client's real batching and throttling code with simulated mouse input for 4 seconds:

| Input rate | Stroke point messages | Cursor messages | Cursor bytes |
|---|---|---|---|
| 60 Hz | 66% fewer | 66% fewer | 66% less |
| 120 Hz | 80% fewer | 82% fewer | 82% less |

Payload bytes for stroke points are 29-35% lower. Byte counts cover the JSON payload only; socket framing would add to the unbatched side.

### Tests and coverage

`npm test` runs 148 tests (110 server, 38 client), and `npm run coverage` reports coverage:

| | Statements | Lines | Functions | Branches |
|---|---|---|---|---|
| Server | 84% | 84% | 90% | 77% |
| Client | 98% | 99% | 100% | 73% |

The server figure includes the integration tests that run against real PostgreSQL and Redis. Client tests cover drawing, streamed updates from other users, note dragging and editing (including lock denials, rolled-back commits and lock renewal), and clearing the board. The one client file with no coverage is `socket.js`, which reads Vite's `import.meta` and can't be loaded under Jest. The component tests replace the Konva canvas with plain elements, so they check behavior rather than pixels.

The app is about 1,200 lines of source across 18 files, plus about 800 lines of tests.

## Scaling across instances

A single server keeps live state in memory. With `REDIS_URL` set, every instance shares state through Redis instead:

- **Broadcasts** go through the Socket.io Redis adapter, so an event from a user on one instance reaches users on all of them.
- **Live state** (strokes, notes, locks) lives in Redis, keyed per board with a `{boardId}` hash tag so each board stays on one Redis Cluster slot.
- **Conflict checks are atomic.** Locking, committing, unlocking and releasing a note each run as a single Lua script, so two instances can't both grant the same lock. Lock expiry uses Redis server time so instances with skewed clocks still agree.
- **Loading from PostgreSQL** happens once per board: the first instance to load it seeds Redis, and later attempts are no-ops.

Both store implementations run the same contract test suite, and an integration test starts multiple instances in one process and checks that strokes, locks, stale commits, and disconnects behave correctly when users are on different instances.

**Out of scope:** layers/vector shapes, undo/redo, auth/permissions, mobile, Figma-level features.
