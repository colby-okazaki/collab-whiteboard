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
```

## Project layout

```
server/   Express + Socket.io server
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

## Scaling across instances

A single server keeps live state in memory. With `REDIS_URL` set, every instance shares state through Redis instead:

- **Broadcasts** go through the Socket.io Redis adapter, so an event from a user on one instance reaches users on all of them.
- **Live state** (strokes, notes, locks) lives in Redis, keyed per board with a `{boardId}` hash tag so each board stays on one Redis Cluster slot.
- **Conflict checks are atomic.** Locking, committing, unlocking and releasing a note each run as a single Lua script, so two instances can't both grant the same lock. Lock expiry uses Redis server time so instances with skewed clocks still agree.
- **Loading from PostgreSQL** happens once per board: the first instance to load it seeds Redis, and later attempts are no-ops.

Both store implementations run the same contract test suite, and an integration test starts multiple instances in one process and checks that strokes, locks, stale commits, and disconnects behave correctly when users are on different instances.

**Out of scope:** layers/vector shapes, undo/redo, auth/permissions, mobile, Figma-level features.
