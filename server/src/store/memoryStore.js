const { LOCK_TTL_MS, isHeldBy, lockRule, commitRule, pickNoteChanges, newNote } = require('./rules');

// Live board state held in this process's memory. Used when the app runs as
// a single server instance (no REDIS_URL). The API is async to match the
// Redis store, so the socket handlers work with either.
class MemoryBoardStore {
  constructor({ lockTtlMs = LOCK_TTL_MS, now = Date.now } = {}) {
    this.boards = new Map();
    this.lockTtlMs = lockTtlMs;
    this.now = now;
  }

  board(boardId) {
    if (!this.boards.has(boardId)) {
      this.boards.set(boardId, { strokes: [], notes: {} });
    }
    return this.boards.get(boardId);
  }

  async isLoaded(boardId) {
    return this.boards.has(boardId);
  }

  // Seeds a board from saved data, e.g. after a server restart. A board
  // that is already live is left alone.
  async hydrate(boardId, { strokes = [], notes = {} }) {
    if (this.boards.has(boardId)) return false;
    this.boards.set(boardId, { strokes: [...strokes], notes: { ...notes } });
    return true;
  }

  async snapshot(boardId) {
    const { strokes, notes } = this.board(boardId);
    return { strokes: [...strokes], notes: { ...notes } };
  }

  async findStroke(boardId, strokeId) {
    return this.board(boardId).strokes.find((s) => s.id === strokeId) || null;
  }

  async addStroke(boardId, stroke) {
    this.board(boardId).strokes.push(stroke);
    return stroke;
  }

  // Appends points to an in-progress stroke. Returns false for unknown strokes.
  async appendPoints(boardId, strokeId, points) {
    const { strokes } = this.board(boardId);
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i].id === strokeId) {
        strokes[i] = { ...strokes[i], points: strokes[i].points.concat(points) };
        return true;
      }
    }
    return false;
  }

  // Notes are replaced, never mutated, so snapshots stay consistent.
  async addNote(boardId, fields) {
    const note = newNote(fields);
    this.board(boardId).notes[note.id] = note;
    return note;
  }

  async lockNote(boardId, noteId, owner) {
    const notes = this.board(boardId).notes;
    const res = lockRule(notes[noteId], owner, this.now(), this.lockTtlMs);
    if (res.ok) notes[noteId] = res.note;
    return res;
  }

  // Drag positions are transient: only the lock holder may broadcast them,
  // and nothing is stored until the drag is committed.
  async canMove(boardId, noteId, ownerId) {
    const note = this.board(boardId).notes[noteId];
    return Boolean(note && isHeldBy(note, ownerId));
  }

  async commitNote(boardId, noteId, ownerId, baseVersion, changes) {
    const notes = this.board(boardId).notes;
    const res = commitRule(notes[noteId], ownerId, baseVersion, pickNoteChanges(changes));
    if (res.ok || res.reason === 'stale') notes[noteId] = res.note;
    return res;
  }

  async unlockNote(boardId, noteId, ownerId) {
    const notes = this.board(boardId).notes;
    const note = notes[noteId];
    if (!note || !isHeldBy(note, ownerId)) return null;
    notes[noteId] = { ...note, lockedBy: null };
    return notes[noteId];
  }

  // Frees every lock held by a user, e.g. when they disconnect mid-drag.
  async releaseLocks(boardId, ownerId) {
    const notes = this.board(boardId).notes;
    const released = [];
    for (const note of Object.values(notes)) {
      if (isHeldBy(note, ownerId)) {
        notes[note.id] = { ...note, lockedBy: null };
        released.push(notes[note.id]);
      }
    }
    return released;
  }

  // Wipes every stroke and note, including any locks.
  async clearBoard(boardId) {
    this.boards.set(boardId, { strokes: [], notes: {} });
  }

  async close() {}
}

module.exports = { MemoryBoardStore };
