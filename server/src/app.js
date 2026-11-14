const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const validate = require('./validate');
const { createRateLimiter } = require('./rateLimit');

// Per connection. Real use peaks around 50 messages a second.
const DEFAULT_RATE_LIMIT = { capacity: 200, perSecond: 100 };

// Builds the HTTP + Socket.io server around a board store (live state) and a
// persistence layer (durable storage). index.js picks the implementations;
// tests use this directly to run several instances side by side.
function createApp({ store, db, clientOrigin, adapter, staticDir, rateLimit = DEFAULT_RATE_LIMIT }) {
  const app = express();
  app.use(cors({ origin: clientOrigin }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  // In production the server also serves the built client, so one process
  // (and one container) is the whole app.
  if (staticDir) app.use(express.static(staticDir));

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: clientOrigin } });
  if (adapter) io.adapter(adapter);

  // Background writes must never take down the real-time path. They run one
  // after another per board, so a slow save can't land after a later clear
  // and bring deleted data back.
  const writeQueues = new Map();
  const persist = (boardId, write, what) => {
    const queued = (writeQueues.get(boardId) || Promise.resolve())
      .then(write)
      .catch((err) => console.error(`Failed to save ${what}:`, err.message));
    writeQueues.set(boardId, queued);
    queued.then(() => {
      if (writeQueues.get(boardId) === queued) writeQueues.delete(boardId);
    });
  };

  // Loads each board from the database at most once per instance, even if
  // several users join while the first load is still in flight. Across
  // instances, the store's hydrate only lets the first load through.
  const cleanups = new Set();
  const loading = new Map();
  async function ensureBoardLoaded(boardId) {
    if (await store.isLoaded(boardId)) return;
    if (!loading.has(boardId)) {
      const load = db
        .loadBoard(boardId)
        .then((saved) => store.hydrate(boardId, saved || { strokes: [], notes: {} }))
        .finally(() => loading.delete(boardId));
      loading.set(boardId, load);
    }
    await loading.get(boardId);
  }

  io.on('connection', (socket) => {
    // Strokes this socket has started but not finished, saved if it drops.
    socket.data.openStrokes = new Set();
    const limiter = createRateLimiter(rateLimit);
    let dropped = 0;
    // Strokes this socket drew, the only ones it may undo.
    socket.data.ownStrokes = new Set();

    const reply = (ack, result) => typeof ack === 'function' && ack(result);

    // Payloads are validated first; malformed ones are dropped, and writes
    // that expect an ack get a rejection instead of silence. Store calls are
    // async, so failures are caught here rather than crashing the process,
    // and acked writes get an error reply.
    const on = (event, parse, handler) =>
      socket.on(event, async (payload, ack) => {
        // A flooding client is dropped message by message, before any
        // validation or store work is spent on it.
        if (!limiter.allow()) {
          dropped += 1;
          return reply(ack, { ok: false, reason: 'rate_limited' });
        }
        try {
          const clean = parse(payload);
          if (clean === null) return reply(ack, { ok: false, reason: 'invalid' });
          await handler(clean, ack);
        } catch (err) {
          console.error(`Error handling ${event}:`, err.message);
          if (typeof ack === 'function') ack({ ok: false, reason: 'error' });
        }
      });
    const boardOf = () => socket.data.boardId;

    on('board:join', validate.boardId, async (boardId) => {
      try {
        await ensureBoardLoaded(boardId);
      } catch (err) {
        console.error(`Failed to load board ${boardId}:`, err.message);
        socket.emit('board:error', 'Could not load board');
        return;
      }
      socket.join(boardId);
      socket.data.boardId = boardId;
      // Late joiners get the current board, not just future updates.
      socket.emit('board:snapshot', await store.snapshot(boardId));
    });

    // Strokes stream while being drawn: start, then batched point updates.
    on('stroke:start', validate.strokeStart, async (stroke) => {
      const boardId = boardOf();
      if (!boardId) return;
      socket.data.openStrokes.add(stroke.id);
      socket.data.ownStrokes.add(stroke.id);
      await store.addStroke(boardId, stroke);
      socket.to(boardId).emit('stroke:start', stroke);
    });

    on('stroke:points', validate.strokePoints, async ({ id, points }) => {
      const boardId = boardOf();
      if (!boardId || !(await store.appendPoints(boardId, id, points))) return;
      socket.to(boardId).emit('stroke:points', { id, points });
    });

    // Strokes are written once, when finished, rather than on every batch.
    const saveStroke = async (boardId, strokeId) => {
      socket.data.openStrokes.delete(strokeId);
      const stroke = await store.findStroke(boardId, strokeId);
      if (stroke) persist(boardId, () => db.saveStroke(boardId, stroke), `stroke ${strokeId}`);
    };

    on('stroke:end', validate.strokeId, async ({ id }) => {
      const boardId = boardOf();
      if (boardId) await saveStroke(boardId, id);
    });

    // Undo removes a stroke for everyone; redo puts the whole stroke back.
    on('stroke:undo', validate.strokeId, async ({ id }) => {
      const boardId = boardOf();
      if (!boardId || !socket.data.ownStrokes.has(id)) return;
      socket.data.ownStrokes.delete(id);
      socket.data.openStrokes.delete(id);
      if (!(await store.removeStroke(boardId, id))) return;
      persist(boardId, () => db.deleteStroke(boardId, id), `removal of stroke ${id}`);
      io.to(boardId).emit('stroke:removed', id);
    });

    on('stroke:restore', validate.strokeRestore, async (stroke) => {
      const boardId = boardOf();
      if (!boardId || (await store.findStroke(boardId, stroke.id))) return;
      socket.data.ownStrokes.add(stroke.id);
      await store.addStroke(boardId, stroke);
      persist(boardId, () => db.saveStroke(boardId, stroke), `stroke ${stroke.id}`);
      socket.to(boardId).emit('stroke:start', stroke);
    });

    // Cursors are ephemeral: relayed to the room, never stored.
    on('cursor:move', validate.cursor, ({ x, y, name, color }) => {
      const boardId = boardOf();
      if (!boardId) return;
      socket.to(boardId).emit('cursor:move', { id: socket.id, x, y, name, color });
    });

    // Sticky notes. Writes are acknowledged so the client can roll back
    // when the server rejects them; see store/rules.js for the conflict rules.
    on('note:add', validate.noteAdd, async (note, ack) => {
      const boardId = boardOf();
      if (!boardId) return;
      const created = await store.addNote(boardId, note);
      persist(boardId, () => db.saveNote(boardId, created), `note ${created.id}`);
      io.to(boardId).emit('note:upsert', created);
      reply(ack, { ok: true, note: created });
    });

    // Also used by the client to refresh its lock while editing.
    on('note:lock', validate.noteLock, async ({ id, name, color }, ack) => {
      const boardId = boardOf();
      if (!boardId) return;
      const res = await store.lockNote(boardId, id, { id: socket.id, name, color });
      if (res.ok) io.to(boardId).emit('note:upsert', res.note);
      reply(ack, res);
    });

    on('note:move', validate.noteMove, async ({ id, x, y }) => {
      const boardId = boardOf();
      if (!boardId || !(await store.canMove(boardId, id, socket.id))) return;
      socket.to(boardId).emit('note:moving', { id, x, y });
    });

    on('note:commit', validate.noteCommit, async ({ id, baseVersion, changes }, ack) => {
      const boardId = boardOf();
      if (!boardId) return;
      const res = await store.commitNote(boardId, id, socket.id, baseVersion, changes);
      if (res.ok) persist(boardId, () => db.saveNote(boardId, res.note), `note ${id}`);
      // On success or a stale rejection the stored note changed (new version
      // or released lock), so everyone gets the authoritative copy.
      if (res.ok || res.reason === 'stale') io.to(boardId).emit('note:upsert', res.note);
      reply(ack, res);
    });

    on('note:unlock', validate.noteUnlock, async ({ id }) => {
      const boardId = boardOf();
      if (!boardId) return;
      const note = await store.unlockNote(boardId, id, socket.id);
      if (note) io.to(boardId).emit('note:upsert', note);
    });

    // Wipes the board for everyone. Anything still in flight for the old
    // content (late points, commits) finds nothing to attach to and is dropped.
    on('board:clear', validate.none, async (_payload, ack) => {
      const boardId = boardOf();
      if (!boardId) return reply(ack, { ok: false, reason: 'not_joined' });
      await store.clearBoard(boardId);
      persist(boardId, () => db.clearBoard(boardId), `clear of board ${boardId}`);
      io.to(boardId).emit('board:cleared');
      reply(ack, { ok: true });
    });

    socket.on('disconnect', () => {
      if (dropped) console.warn(`Dropped ${dropped} messages from ${socket.id} for sending too fast`);
      const boardId = boardOf();
      if (!boardId) return;
      socket.to(boardId).emit('cursor:leave', socket.id);
      const cleanup = (async () => {
        try {
          await Promise.all([...socket.data.openStrokes].map((id) => saveStroke(boardId, id)));
          for (const note of await store.releaseLocks(boardId, socket.id)) {
            socket.to(boardId).emit('note:upsert', note);
          }
        } catch (err) {
          console.error('Error cleaning up after disconnect:', err.message);
        }
      })();
      cleanups.add(cleanup);
      cleanup.finally(() => cleanups.delete(cleanup));
    });
  });

  // Stops accepting connections, lets every client's disconnect cleanup run
  // (saving half-drawn strokes), then waits for queued database writes, so a
  // deploy or restart doesn't lose what was just drawn.
  async function shutdown() {
    await new Promise((resolve) => io.close(resolve));
    await Promise.all([...cleanups]);
    while (writeQueues.size) await Promise.all([...writeQueues.values()]);
  }

  return { server, io, shutdown };
}

module.exports = { createApp };
